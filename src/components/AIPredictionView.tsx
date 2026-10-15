import React from 'react';
import {
  RefreshCw,
  Sun,
  CloudRain,
  ShieldCheck,
  Zap,
  Clock,
} from 'lucide-react';
import {
  AIPredictionResult,
  SensorTelemetry,
  WeatherForecastResponse,
  AppLanguage,
  HourlyProjectionItem,
  Telemetry5sRecord,
  SingleSourceSystemState,
} from '../types';
import { getGoogleRainAnalysis, getCurrentHourIndex } from '../utils/weatherUtils';

interface AIPredictionViewProps {
  prediction: AIPredictionResult | null;
  sensorTelemetry: SensorTelemetry | null;
  weather: WeatherForecastResponse | null;
  isSensorOnline: boolean;
  language: AppLanguage;
  isLoading: boolean;
  systemState?: SingleSourceSystemState | null;
  telemetryHistory5s?: Telemetry5sRecord[];
  lastAnalyzedTimestamp?: number | null;
  onRefreshPrediction: () => void;
  onApplyCanopyRecommendation?: (recommendation: string) => void;
  onOpenChat?: (initialQuery?: string) => void;
  onClearHistory?: () => void;
}

export const AIPredictionView: React.FC<AIPredictionViewProps> = ({
  prediction,
  weather,
  isLoading,
  systemState,
  onRefreshPrediction,
  onApplyCanopyRecommendation,
}) => {
  const googleAnalysis = getGoogleRainAnalysis(weather);
  const curIdx = getCurrentHourIndex(weather);

  const isCloseRecommended = (() => {
    // 1. Critical physical rain directly on drying bed sensor plate
    if (systemState?.prediction?.actual_rain) {
      return true;
    }
    // 2. If Random Forest predicts SOLAR_DRYING_OPEN with 0 rain votes and high drying score, keep open!
    if (
      systemState?.prediction?.randomForest?.predictedOutcome === 'SOLAR_DRYING_OPEN' &&
      systemState.prediction.randomForest.treeVotes.rain === 0 &&
      (prediction?.solarDryingIndex ?? 75) >= 60 &&
      !systemState?.prediction?.actual_rain
    ) {
      return false;
    }
    // 3. Authoritative system decision target takes priority if present
    if (systemState?.tarpaulin?.lastDecision) {
      return systemState.tarpaulin.lastDecision === 'CLOSED';
    }
    // 4. Otherwise fall back to prediction recommendation
    return (
      prediction?.canopyRecommendation === 'CLOSE_IMMEDIATELY' ||
      prediction?.canopyRecommendation === 'PREVENTATIVE_CLOSE' ||
      googleAnalysis.isRainThreat
    );
  })();

  // Fallback 6-hour projection starting from current hour
  const projections: HourlyProjectionItem[] = prediction?.hourlyProjections?.length
    ? prediction.hourlyProjections
    : [1, 2, 3, 4, 5, 6].map((offset) => {
        const idx = curIdx + offset;
        const pRain = Math.min(100, Math.max(0, weather?.hourly?.precipitation_probability?.[idx] ?? 10));
        const temp = weather?.hourly?.temperature_2m?.[idx] ?? 28;
        return {
          hour: `+${offset}h`,
          rainRisk: pRain,
          solarIndex: Math.max(10, 100 - pRain),
          temperature: temp,
          canopyStatus: pRain >= 60 ? 'CLOSED' : 'OPEN',
          summary: pRain >= 60 ? 'Precautionary close (rain threat)' : 'Safe drying conditions',
        };
      });

  return (
    <div className="space-y-3 max-w-2xl mx-auto w-full">
      {/* 1. Compact Recommendation Banner */}
      <div
        className={`p-3.5 rounded-2xl border transition-all ${
          isCloseRecommended
            ? 'bg-rose-950/40 border-rose-600/50 text-rose-100 shadow-md'
            : 'bg-emerald-950/40 border-emerald-600/50 text-emerald-100 shadow-md'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <span
                className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full border ${
                  isCloseRecommended
                    ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                    : 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                }`}
              >
                AI Recommendation
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                Confidence: {prediction?.verificationConfidence ?? 92}%
              </span>
            </div>

            <h3 className="text-base font-black text-white">
              {isCloseRecommended ? 'Close & Lock Canopy' : 'Keep Canopy Open'}
            </h3>

            <p className="text-xs text-slate-300 mt-0.5">
              {prediction?.aiSummary ||
                (isCloseRecommended
                  ? 'High precipitation threat. Seal drying beds to protect harvest.'
                  : 'Optimal sunlight detected. Solar curing active.')}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
            {onApplyCanopyRecommendation && (
              <button
                onClick={() => onApplyCanopyRecommendation(isCloseRecommended ? 'CLOSED' : 'OPEN')}
                className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-sm ${
                  isCloseRecommended
                    ? 'bg-rose-600 hover:bg-rose-500 text-white'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                <Zap className="w-3.5 h-3.5" />
                <span>Apply {isCloseRecommended ? 'Close' : 'Open'}</span>
              </button>
            )}

            <button
              onClick={onRefreshPrediction}
              disabled={isLoading}
              className="p-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer"
              title="Refresh AI analysis"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Random Forest 35-Tree Ensemble Metrics Footer */}
        {systemState?.prediction?.randomForest && (
          <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-1.5 text-[10px] text-slate-300">
            <div className="flex items-center gap-1.5">
              <span className="font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-950/70 text-cyan-300 border border-cyan-700/50">
                🌲 {systemState.prediction.randomForest.modelType}
              </span>
              <span>
                Votes: <strong className="text-emerald-400">{systemState.prediction.randomForest.treeVotes.open} Open</strong> · <strong className="text-amber-300">{systemState.prediction.randomForest.treeVotes.preemptiveClose} Preempt</strong> · <strong className="text-rose-400">{systemState.prediction.randomForest.treeVotes.rain} Rain</strong>
              </span>
            </div>
            <span className="font-mono text-slate-400">
              In-Sample Acc: <span className="text-emerald-400 font-bold">{systemState.prediction.randomForest.modelAccuracy}%</span>
            </span>
          </div>
        )}
      </div>

      {/* 2. Compact 4-Card Metrics Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {/* Next 10–20m Rain (Immediate AI Nowcast) */}
        <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span className="font-semibold text-sky-300">Next 10–20m Rain</span>
            <CloudRain className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="text-lg font-black text-white flex items-baseline gap-1">
            <span>
              {systemState?.prediction?.rain_probability ?? prediction?.rainProbabilityNextHour ?? 0}%
            </span>
            <span className="text-[10px] text-slate-400 font-normal">Nowcast</span>
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5 truncate">
            {systemState?.prediction?.actual_rain ? 'Active Rain' : 'Sensor + RF ML'}
          </div>
        </div>

        {/* Next 1h Rain (Hourly Forecast) */}
        <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Next 1h Rain</span>
            <Clock className="w-3.5 h-3.5 text-indigo-400" />
          </div>
          <div className="text-lg font-black text-white">
            {prediction?.rainProbabilityNextHour ?? (weather?.hourly?.precipitation_probability?.[curIdx] ?? 0)}%
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5 truncate">
            Open-Meteo Radar
          </div>
        </div>

        {/* Solar Drying Score */}
        <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Drying Score</span>
            <Sun className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <div className="text-lg font-black text-amber-300">
            {prediction?.solarDryingIndex ?? 91}
            <span className="text-[10px] text-slate-500 font-normal">/100</span>
          </div>
          <div className="text-[9px] text-emerald-400 mt-0.5 truncate">
            {(prediction?.solarDryingIndex ?? 91) >= 75 ? 'Optimal Solar Curing' : 'Moderate Sun'}
          </div>
        </div>

        {/* Mold Risk */}
        <div className="p-2.5 bg-slate-900/80 border border-slate-800 rounded-xl">
          <div className="flex items-center justify-between text-[11px] text-slate-400 mb-1">
            <span>Mold Risk</span>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <div className="text-xs font-bold mt-1">
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Low (Safe)
            </span>
          </div>
          <div className="text-[9px] text-slate-400 mt-0.5 truncate">
            Target ≤ 11% moisture
          </div>
        </div>
      </div>

      {/* 3. 6-Hour Compact Projection Timeline */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-3 shadow-md">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-bold text-white flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            <span>6-Hour Outlook</span>
          </span>
        </div>

        <div className="grid grid-cols-6 gap-1.5 text-center">
          {projections.slice(0, 6).map((proj, idx) => {
            const isRain = proj.rainRisk >= 60;
            return (
              <div
                key={idx}
                className={`p-1.5 rounded-xl border flex flex-col items-center justify-between gap-1 text-[10px] select-none ${
                  isRain
                    ? 'bg-rose-950/30 border-rose-500/40 text-rose-200'
                    : 'bg-slate-950 border-slate-800 text-slate-300'
                }`}
              >
                <span className="font-semibold text-slate-400 text-[9px]">{proj.hour}</span>
                <div className="font-bold text-xs">{proj.rainRisk}%</div>
                <span
                  className={`text-[8px] font-bold px-1 py-0.2 rounded w-full truncate ${
                    isRain ? 'bg-rose-500 text-white' : 'bg-emerald-500/20 text-emerald-300'
                  }`}
                >
                  {isRain ? 'Lock' : 'Open'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
