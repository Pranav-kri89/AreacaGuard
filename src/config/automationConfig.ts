/**
 * ARECAGUARD CENTRALIZED AUTOMATION CONFIGURATION
 * 
 * Configurable parameters governing the 3 independent operating modes:
 * - MODE 1: Sensors Mode (Hardware only, LDR hysteresis 50%-60%, rain plate priority)
 * - MODE 2: Forecast Mode (Internet only, 6h Open-Meteo horizon, Rain Risk 0-100, low radiation check)
 * - MODE 3: Combined Mode (Primary intelligent mode, priority safety fusion, 10m post-rain delay)
 */

export interface AutomationConfig {
  // Rain Risk classification thresholds
  RAIN_WATCH_THRESHOLD: number;          // 30  (30-59: RAIN WATCH)
  RAIN_CLOSE_THRESHOLD: number;          // 60  (60-100: RAIN THREAT)

  // Mode 1 & Mode 3 LDR Sunlight hysteresis thresholds (%)
  LDR_OPEN_THRESHOLD: number;            // 60% (Open when LDR > 60%)
  LDR_CLOSE_THRESHOLD: number;           // 50% (Close when LDR < 50%)

  // Precipitation intensity limits (mm)
  SIGNIFICANT_PRECIPITATION_MM: number;  // 1.0 mm (Immediate rain close trigger)
  DRY_PRECIPITATION_MM: number;          // 0.5 mm (Safe dry opening threshold)

  // Solar radiation & overcast cloud limits
  HEAVY_CLOUD_THRESHOLD: number;         // 80% (Dense cloud cover limit)
  LOW_SOLAR_RADIATION_WM2: number;       // 150 W/m² (Minimum irradiance for solar drying)

  // Timing and horizons
  FORECAST_REFRESH_MINUTES: number;      // 10 minutes (Open-Meteo refresh interval)
  RAIN_REOPEN_DELAY_MINUTES: number;     // 10 minutes (Continuous dry requirement after rain)
  FORECAST_HORIZON_HOURS: number;        // 6 hours (Analysis window for incoming weather)
}

export const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  RAIN_WATCH_THRESHOLD: 30,
  RAIN_CLOSE_THRESHOLD: 60,
  LDR_OPEN_THRESHOLD: 60,
  LDR_CLOSE_THRESHOLD: 50,
  SIGNIFICANT_PRECIPITATION_MM: 1.0,
  DRY_PRECIPITATION_MM: 0.5,
  HEAVY_CLOUD_THRESHOLD: 80,
  LOW_SOLAR_RADIATION_WM2: 150,
  FORECAST_REFRESH_MINUTES: 10,
  RAIN_REOPEN_DELAY_MINUTES: 10,
  FORECAST_HORIZON_HOURS: 6,
};

/**
 * Returns effective AutomationConfig by merging defaults with any user-overridden farm settings
 */
export function getEffectiveAutomationConfig(farmSettings?: any): AutomationConfig {
  if (!farmSettings) return { ...DEFAULT_AUTOMATION_CONFIG };

  return {
    RAIN_WATCH_THRESHOLD: farmSettings.rainWatchThreshold ?? farmSettings.openRainThreshold ?? DEFAULT_AUTOMATION_CONFIG.RAIN_WATCH_THRESHOLD,
    RAIN_CLOSE_THRESHOLD: farmSettings.rainCloseThreshold ?? farmSettings.closeRainThreshold ?? DEFAULT_AUTOMATION_CONFIG.RAIN_CLOSE_THRESHOLD,
    LDR_OPEN_THRESHOLD: farmSettings.ldrOpenThreshold ?? farmSettings.sunlightCloseThresholdPercent ?? DEFAULT_AUTOMATION_CONFIG.LDR_OPEN_THRESHOLD,
    LDR_CLOSE_THRESHOLD: farmSettings.ldrCloseThreshold ?? DEFAULT_AUTOMATION_CONFIG.LDR_CLOSE_THRESHOLD,
    SIGNIFICANT_PRECIPITATION_MM: farmSettings.significantPrecipitationMm ?? DEFAULT_AUTOMATION_CONFIG.SIGNIFICANT_PRECIPITATION_MM,
    DRY_PRECIPITATION_MM: farmSettings.dryPrecipitationMm ?? farmSettings.onlinePrecipRateThreshold ?? DEFAULT_AUTOMATION_CONFIG.DRY_PRECIPITATION_MM,
    HEAVY_CLOUD_THRESHOLD: farmSettings.heavyCloudThreshold ?? farmSettings.onlineCloudCoverThreshold ?? DEFAULT_AUTOMATION_CONFIG.HEAVY_CLOUD_THRESHOLD,
    LOW_SOLAR_RADIATION_WM2: farmSettings.lowSolarRadiationWm2 ?? DEFAULT_AUTOMATION_CONFIG.LOW_SOLAR_RADIATION_WM2,
    FORECAST_REFRESH_MINUTES: farmSettings.forecastRefreshMinutes ?? farmSettings.onlineSyncIntervalMinutes ?? DEFAULT_AUTOMATION_CONFIG.FORECAST_REFRESH_MINUTES,
    RAIN_REOPEN_DELAY_MINUTES: farmSettings.rainReopenDelayMinutes ?? DEFAULT_AUTOMATION_CONFIG.RAIN_REOPEN_DELAY_MINUTES,
    FORECAST_HORIZON_HOURS: farmSettings.forecastHorizonHours ?? DEFAULT_AUTOMATION_CONFIG.FORECAST_HORIZON_HOURS,
  };
}
