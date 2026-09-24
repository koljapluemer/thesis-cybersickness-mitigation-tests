"""Agreement and association of two autocorrelated time series.

Generic statistics for a reference series x and a measure y sampled together,
see doc/pose-flow-agreement.md for the methods and how to read them:

- cross-correlation function; its peak lag is a diagnostic, statistics are
  computed without shifting (the series are assumed synchronous)
- association: Pearson and Spearman correlation
- agreement (same units only): Lin's concordance correlation, Bland-Altman bias
  and limits of agreement, calibration line
- serial dependence: Bartlett effective sample size for the correlation's
  p-value, moving block bootstrap for all confidence intervals
- frequency: magnitude-squared coherence
- time: rolling correlation
- residual regression (same units only): which covariates explain y - x
"""

from __future__ import annotations

from dataclasses import dataclass

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.gridspec import GridSpec
from scipy import signal, stats

MIN_SEGMENT_SEC = 2.0
MAX_LAG_SEC = 2.0
MAX_AUTOCORRELATION_LAG_SEC = 30.0
COHERENCE_WINDOW_SEC = 8.0
COHERENCE_BANDS_HZ = ((0.0, 0.2), (0.2, 1.0), (1.0, 5.0))
ROLLING_WINDOW_SEC = 5.0
BOOTSTRAP_REPLICATES = 1000
CONFIDENCE = 0.95
# Spread below which a signal counts as constant (pose round-off is ~1e-14).
NEGLIGIBLE_SPREAD = 1e-6


@dataclass
class Series:
    """Signals resampled onto a uniform grid, in contiguous segments."""

    t: np.ndarray
    segment: np.ndarray
    rate_hz: float
    values: dict[str, np.ndarray]


@dataclass
class Pair:
    name: str
    x: str
    y: str
    x_label: str
    y_label: str
    unit: str
    same_units: bool
    covariates: tuple[str, ...] = ()


def resample(t: np.ndarray, columns: dict[str, np.ndarray], rate_hz: float) -> Series:
    """Linear interpolation onto a uniform grid within each run where all columns are finite.

    A NaN in any column splits the recording; runs shorter than MIN_SEGMENT_SEC are dropped.
    """
    finite = np.all([np.isfinite(column) for column in columns.values()], axis=0)
    edges = np.flatnonzero(np.diff(np.r_[0, finite.astype(int), 0]))
    grid_t, grid_segment, grid_values = [], [], {name: [] for name in columns}
    for start, stop in zip(edges[::2], edges[1::2]):
        if t[stop - 1] - t[start] < MIN_SEGMENT_SEC:
            continue
        grid = np.arange(t[start], t[stop - 1], 1 / rate_hz)
        grid_t.append(grid)
        grid_segment.append(np.full(len(grid), len(grid_t) - 1))
        for name, column in columns.items():
            grid_values[name].append(np.interp(grid, t[start:stop], column[start:stop]))
    if not grid_t:
        raise ValueError(f"no run of at least {MIN_SEGMENT_SEC} s with all signals present")
    return Series(
        t=np.concatenate(grid_t),
        segment=np.concatenate(grid_segment),
        rate_hz=rate_hz,
        values={name: np.concatenate(parts) for name, parts in grid_values.items()},
    )


def aligned(x: np.ndarray, y: np.ndarray, segment: np.ndarray, lag: int):
    """Pairs (x[i], y[i + lag]) within the same segment, and the segment of each pair."""
    n = len(x)
    if lag >= 0:
        xs, ys, sx, sy = x[: n - lag], y[lag:], segment[: n - lag], segment[lag:]
    else:
        xs, ys, sx, sy = x[-lag:], y[: n + lag], segment[-lag:], segment[: n + lag]
    same = sx == sy
    return xs[same], ys[same], sx[same]


def pearson(x: np.ndarray, y: np.ndarray) -> float:
    x, y = x - x.mean(), y - y.mean()
    denominator = np.sqrt(np.sum(x * x) * np.sum(y * y))
    return float(np.sum(x * y) / denominator) if denominator > 0 else float("nan")


def usable_lag(segment: np.ndarray, lag_sec: float, rate_hz: float) -> int:
    """lag_sec in samples, capped so that the longest segment keeps a few pairs."""
    return int(min(round(lag_sec * rate_hz), np.bincount(segment).max() - 3))


def cross_correlation(x, y, segment, max_lag: int) -> tuple[np.ndarray, np.ndarray]:
    lags = np.arange(-max_lag, max_lag + 1)
    return lags, np.array([pearson(*aligned(x, y, segment, lag)[:2]) for lag in lags])


def autocorrelation(x, segment, max_lag: int) -> np.ndarray:
    return np.array([pearson(*aligned(x, x, segment, lag)[:2]) for lag in range(max_lag + 1)])


def effective_sample_size(acf_x: np.ndarray, acf_y: np.ndarray, n: int) -> float:
    """Bartlett: n / (1 + 2 sum_k acf_x(k) acf_y(k)), summed until the product first drops to 0."""
    product = acf_x[1:] * acf_y[1:]
    stop = np.flatnonzero(~(product > 0))
    total = np.sum(product[: stop[0]] if len(stop) else product)
    return float(np.clip(n / (1 + 2 * total), 2, n))


def decorrelation_lag(acf: np.ndarray) -> int:
    """First lag at which the autocorrelation falls below 1/e."""
    below = np.flatnonzero(acf < 1 / np.e)
    return int(below[0]) if len(below) else len(acf)


def block_bootstrap(segment: np.ndarray, block: int, replicates: int, rng: np.random.Generator) -> list[np.ndarray]:
    """Moving block bootstrap index sets; blocks never straddle a segment boundary."""
    n = len(segment)
    block = int(min(block, np.bincount(segment).max()))
    starts = np.flatnonzero(segment[: n - block + 1] == segment[block - 1 :])
    count = -(-n // block)
    offsets = np.arange(block)
    return [(rng.choice(starts, count)[:, None] + offsets).ravel()[:n] for _ in range(replicates)]


def point_statistics(x: np.ndarray, y: np.ndarray, same_units: bool) -> dict[str, float]:
    result = {"pearsonR": pearson(x, y), "spearmanRho": pearson(stats.rankdata(x), stats.rankdata(y))}
    if same_units:
        difference = y - x
        covariance = np.mean((x - x.mean()) * (y - y.mean()))
        slope = covariance / np.var(x)
        result |= {
            "concordanceCcc": float(2 * covariance / (np.var(x) + np.var(y) + (x.mean() - y.mean()) ** 2)),
            "bias": float(difference.mean()),
            "differenceSd": float(difference.std(ddof=1)),
            "limitsOfAgreementLow": float(difference.mean() - 1.96 * difference.std(ddof=1)),
            "limitsOfAgreementHigh": float(difference.mean() + 1.96 * difference.std(ddof=1)),
            "rmse": float(np.sqrt(np.mean(difference**2))),
            "calibrationSlope": float(slope),
            "calibrationIntercept": float(y.mean() - slope * x.mean()),
        }
    return result


def residual_design(x: np.ndarray, covariates: dict[str, np.ndarray]) -> tuple[list[str], np.ndarray]:
    """Terms for y - x: x (scale error), each standardised covariate z (offset) and x*z (scale error depending on z)."""
    names, columns = ["intercept", "x"], [np.ones_like(x), x]
    for name, z in covariates.items():
        spread = z.std()
        if spread < NEGLIGIBLE_SPREAD:
            continue
        z = (z - z.mean()) / spread
        names += [name, f"x*{name}"]
        columns += [z, x * z]
    return names, np.column_stack(columns)


def residual_regression(x, y, design: np.ndarray) -> tuple[np.ndarray, float]:
    difference = y - x
    coefficients, *_ = np.linalg.lstsq(design, difference, rcond=None)
    residual = difference - design @ coefficients
    total = np.sum((difference - difference.mean()) ** 2)
    return coefficients, float(1 - np.sum(residual**2) / total) if total > 0 else float("nan")


def coherence(x, y, segment, rate_hz: float) -> tuple[np.ndarray, np.ndarray]:
    """Welch magnitude-squared coherence, spectra pooled over segments weighted by length."""
    lengths = np.bincount(segment)
    window = int(min(COHERENCE_WINDOW_SEC * rate_hz, lengths.max()))
    pxx = pyy = pxy = 0
    for index in np.flatnonzero(lengths >= window):
        part = segment == index
        frequency, sxx = signal.welch(x[part], rate_hz, nperseg=window)
        _, syy = signal.welch(y[part], rate_hz, nperseg=window)
        _, sxy = signal.csd(x[part], y[part], rate_hz, nperseg=window)
        pxx, pyy, pxy = pxx + lengths[index] * sxx, pyy + lengths[index] * syy, pxy + lengths[index] * sxy
    with np.errstate(invalid="ignore", divide="ignore"):
        return frequency, np.abs(pxy) ** 2 / (pxx * pyy)


def rolling_correlation(x, y, segment, window: int) -> np.ndarray:
    """Pearson r over a centred window, NaN where the window leaves the segment."""
    out = np.full(len(x), np.nan)
    kernel = np.ones(window) / window
    for index in np.unique(segment):
        part = np.flatnonzero(segment == index)
        if len(part) < window:
            continue
        xs, ys = x[part], y[part]

        def mean(values):
            return np.convolve(values, kernel, mode="valid")

        mx, my = mean(xs), mean(ys)
        covariance = mean(xs * ys) - mx * my
        with np.errstate(invalid="ignore", divide="ignore"):
            r = covariance / np.sqrt((mean(xs * xs) - mx**2) * (mean(ys * ys) - my**2))
        out[part[window // 2 : window // 2 + len(r)]] = r
    return out


def interval(samples: np.ndarray) -> list[float]:
    tail = (1 - CONFIDENCE) / 2 * 100
    return [float(v) for v in np.nanpercentile(samples, [tail, 100 - tail])]


def compare(series: Series, pair: Pair, seed: int = 0) -> dict:
    """All statistics of one pair; `plot` holds the arrays the figure needs."""
    x, y, segment = series.values[pair.x], series.values[pair.y], series.segment
    if x.std() < NEGLIGIBLE_SPREAD or y.std() < NEGLIGIBLE_SPREAD:
        return {"skipped": "no variation in at least one signal"}

    lags, ccf = cross_correlation(x, y, segment, usable_lag(segment, MAX_LAG_SEC, series.rate_hz))
    peak_lag = int(lags[np.nanargmax(ccf)])

    acf_lag = usable_lag(segment, MAX_AUTOCORRELATION_LAG_SEC, series.rate_hz)
    acf_x = autocorrelation(x, segment, acf_lag)
    acf_y = autocorrelation(y, segment, acf_lag)
    n_eff = effective_sample_size(acf_x, acf_y, len(x))
    block = max(decorrelation_lag(acf_x), decorrelation_lag(acf_y), 1)

    point = point_statistics(x, y, pair.same_units)
    r = point["pearsonR"]
    t_value = r * np.sqrt((n_eff - 2) / max(1 - r * r, 1e-12))
    names, design = residual_design(x, {name: series.values[name] for name in pair.covariates})
    residual = residual_regression(x, y, design) if pair.same_units else None

    rng = np.random.default_rng(seed)
    boot_point, boot_coefficients, boot_r2 = [], [], []
    for index in block_bootstrap(segment, block, BOOTSTRAP_REPLICATES, rng):
        boot_point.append(point_statistics(x[index], y[index], pair.same_units))
        if residual is not None:
            coefficients, r2 = residual_regression(x[index], y[index], design[index])
            boot_coefficients.append(coefficients)
            boot_r2.append(r2)

    result = {
        "reference": pair.x,
        "measure": pair.y,
        "sameUnits": pair.same_units,
        "samples": len(x),
        "durationSec": len(x) / series.rate_hz,
        "segments": len(np.unique(segment)),
        "ccfPeakLagMs": peak_lag / series.rate_hz * 1000,
        "ccfPeakLagMeaning": "positive = measure lags reference; expected 0 for synchronous series",
        "ccfPeakAtSearchLimit": bool(abs(peak_lag) == lags[-1]),
        "effectiveSampleSize": n_eff,
        "bootstrapBlockSec": block / series.rate_hz,
        "bootstrapBlocksPerSession": len(x) / block,
        "pearsonPValue": float(2 * stats.t.sf(abs(t_value), n_eff - 2)),
        "statistics": {key: {"value": value, "ci95": interval(np.array([b[key] for b in boot_point]))} for key, value in point.items()},
    }
    frequency, coherence_values = coherence(x, y, segment, series.rate_hz)
    result["coherenceBands"] = [
        {"minHz": low, "maxHz": high, "meanCoherence": float(np.nanmean(coherence_values[(frequency >= low) & (frequency < high)]))}
        for low, high in COHERENCE_BANDS_HZ
    ]
    if residual is not None:
        coefficients, r2 = residual
        boot_coefficients = np.array(boot_coefficients)
        result["residualRegression"] = {
            "target": "measure - reference",
            "rSquared": {"value": r2, "ci95": interval(np.array(boot_r2))},
            "coefficients": {
                name: {"value": float(value), "ci95": interval(boot_coefficients[:, index])}
                for index, (name, value) in enumerate(zip(names, coefficients))
            },
        }
    result["plot"] = {
        "t": series.t,
        "segment": segment,
        "x": x,
        "y": y,
        "lagsSec": lags / series.rate_hz,
        "ccf": ccf,
        "frequency": frequency,
        "coherence": coherence_values,
        "rolling": rolling_correlation(x, y, segment, int(ROLLING_WINDOW_SEC * series.rate_hz)),
    }
    return result


def with_gaps(t: np.ndarray, segment: np.ndarray, values: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Insert NaN between segments so line plots do not bridge them."""
    breaks = np.flatnonzero(np.diff(segment)) + 1
    return np.insert(t.astype(float), breaks, np.nan), np.insert(values.astype(float), breaks, np.nan)


def plot_pair(pair: Pair, result: dict, path) -> None:
    data = result["plot"]
    statistics = result["statistics"]
    figure = plt.figure(figsize=(15, 11))
    grid = GridSpec(3, 3, figure=figure, height_ratios=[1, 1.2, 1.2])
    figure.suptitle(f"{pair.y_label}  vs.  {pair.x_label}")

    axis = figure.add_subplot(grid[0, :])
    axis.plot(*with_gaps(data["t"], data["segment"], data["x"]), label=f"reference: {pair.x_label}", linewidth=0.9)
    axis.plot(*with_gaps(data["t"], data["segment"], data["y"]), label=f"measure: {pair.y_label}", linewidth=0.9)
    if pair.same_units:
        axis.plot(*with_gaps(data["t"], data["segment"], data["y"] - data["x"]), label="measure − reference", color="grey", linewidth=0.7)
    axis.axhline(0, color="black", linewidth=0.4)
    axis.set_xlabel("session time (s)")
    axis.set_ylabel(pair.unit)
    axis.legend(loc="upper right", fontsize=8)

    x, y = data["x"], data["y"]
    axis = figure.add_subplot(grid[1, 0])
    axis.scatter(x, y, s=2, alpha=0.2)
    line = np.array([x.min(), x.max()])
    if pair.same_units:
        axis.plot(line, line, color="black", linewidth=0.8, label="identity")
        slope, intercept = statistics["calibrationSlope"]["value"], statistics["calibrationIntercept"]["value"]
        axis.plot(line, intercept + slope * line, color="C3", label=f"fit: {slope:.2f}·x {intercept:+.2f}")
        axis.legend(fontsize=8)
    axis.set_xlabel(f"reference ({pair.unit})")
    axis.set_ylabel(f"measure ({pair.unit})")
    title = f"r = {statistics['pearsonR']['value']:.3f}, ρ = {statistics['spearmanRho']['value']:.3f}"
    if pair.same_units:
        title += f", CCC = {statistics['concordanceCcc']['value']:.3f}"
    axis.set_title(title, fontsize=10)

    axis = figure.add_subplot(grid[1, 1])
    if pair.same_units:
        axis.scatter((x + y) / 2, y - x, s=2, alpha=0.2)
        for key, style in (("bias", "-"), ("limitsOfAgreementLow", "--"), ("limitsOfAgreementHigh", "--")):
            axis.axhline(statistics[key]["value"], color="C3", linestyle=style, linewidth=0.9)
            axis.axhspan(*statistics[key]["ci95"], color="C3", alpha=0.12)
        axis.set_xlabel(f"mean of both ({pair.unit})")
        axis.set_ylabel(f"measure − reference ({pair.unit})")
        axis.set_title(
            f"Bland–Altman: bias {statistics['bias']['value']:.2f}, "
            f"LoA [{statistics['limitsOfAgreementLow']['value']:.2f}, {statistics['limitsOfAgreementHigh']['value']:.2f}]",
            fontsize=10,
        )
    else:
        axis.text(0.5, 0.5, "different units:\nassociation only", ha="center", va="center", transform=axis.transAxes)
        axis.set_axis_off()

    axis = figure.add_subplot(grid[1, 2])
    axis.plot(data["lagsSec"] * 1000, data["ccf"])
    axis.axvline(result["ccfPeakLagMs"], color="C3", linestyle="--", linewidth=0.8)
    axis.set_xlabel("lag (ms, + = measure lags)")
    axis.set_ylabel("r")
    axis.set_title(f"cross-correlation, peak at {result['ccfPeakLagMs']:.0f} ms", fontsize=10)

    axis = figure.add_subplot(grid[2, 0])
    positive = data["frequency"] > 0
    axis.semilogx(data["frequency"][positive], data["coherence"][positive])
    for band in result["coherenceBands"]:
        axis.hlines(band["meanCoherence"], max(band["minHz"], data["frequency"][positive][0]), band["maxHz"], color="C3", linewidth=2)
    axis.set_ylim(0, 1.02)
    axis.set_xlabel("frequency (Hz)")
    axis.set_ylabel("coherence")
    axis.set_title("magnitude-squared coherence (red: band means)", fontsize=10)

    axis = figure.add_subplot(grid[2, 1])
    axis.plot(*with_gaps(data["t"], data["segment"], data["rolling"]), linewidth=0.9)
    axis.set_ylim(-1.05, 1.05)
    axis.axhline(0, color="black", linewidth=0.4)
    axis.set_xlabel("session time (s)")
    axis.set_ylabel("r")
    axis.set_title(f"rolling correlation ({ROLLING_WINDOW_SEC:.0f} s window)", fontsize=10)

    axis = figure.add_subplot(grid[2, 2])
    if "residualRegression" in result:
        regression = result["residualRegression"]
        terms = [name for name in regression["coefficients"] if name != "intercept"]
        values = np.array([regression["coefficients"][name]["value"] for name in terms])
        bounds = np.array([regression["coefficients"][name]["ci95"] for name in terms])
        positions = np.arange(len(terms))
        axis.errorbar(values, positions, xerr=[values - bounds[:, 0], bounds[:, 1] - values], fmt="o", capsize=3)
        axis.axvline(0, color="black", linewidth=0.4)
        axis.set_yticks(positions, terms, fontsize=8)
        axis.invert_yaxis()
        axis.set_xlabel("coefficient (per unit x / per SD of covariate)")
        axis.set_title(f"residual regression, R² = {regression['rSquared']['value']:.2f}", fontsize=10)
    else:
        axis.set_axis_off()

    figure.tight_layout()
    figure.savefig(path, dpi=100)
    plt.close(figure)


def plot_summary(pairs: list[Pair], results: dict[str, dict], path) -> None:
    """Forest plot of the correlation-type statistics with bootstrap CIs, one row per pair."""
    keys = (("pearsonR", "Pearson r"), ("spearmanRho", "Spearman ρ"), ("concordanceCcc", "Lin CCC"))
    shown = [pair for pair in pairs if "skipped" not in results[pair.name]]
    figure, axis = plt.subplots(figsize=(10, 1.2 + 0.9 * len(shown)))
    for row, pair in enumerate(shown):
        statistics = results[pair.name]["statistics"]
        for offset, (key, label) in enumerate(keys):
            if key not in statistics:
                continue
            value, (low, high) = statistics[key]["value"], statistics[key]["ci95"]
            axis.errorbar(
                value,
                row + (offset - 1) * 0.22,
                xerr=[[value - low], [high - value]],
                fmt="o",
                color=f"C{offset}",
                capsize=3,
                label=label if row == 0 else None,
            )
    axis.set_yticks(range(len(shown)), [f"{pair.y_label}\nvs. {pair.x_label}" for pair in shown], fontsize=8)
    axis.invert_yaxis()
    axis.axvline(0, color="black", linewidth=0.4)
    axis.axvline(1, color="grey", linewidth=0.4, linestyle=":")
    axis.set_xlabel(f"value with {CONFIDENCE:.0%} block-bootstrap CI")
    figure.legend(loc="upper center", ncol=len(keys), fontsize=8)
    figure.tight_layout(rect=(0, 0, 1, 0.93))
    figure.savefig(path, dpi=110)
    plt.close(figure)
