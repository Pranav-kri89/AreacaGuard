import fs from "fs";
import path from "path";
import {
  SensorTelemetry,
  SensorValidationSummary,
  SensorHealthStatus,
  Spatial30LocationMetrics,
  UnifiedRainPrediction,
  RainRiskLevel,
  PredictionDataStatus,
  SystemOperatingMode,
  SingleSourceSystemState,
  FarmSettings,
  CanopyMode,
  HeaterDryerState,
  DecisionMode,
} from "../src/types";
import {
  AutomationConfig,
  DEFAULT_AUTOMATION_CONFIG,
  getEffectiveAutomationConfig,
} from "../src/config/automationConfig";
import { randomForestModel } from "./randomForestModel";

// Rolling window for sensor telemetry to calculate 5-minute and 15-minute trends
interface TelemetryPoint {
  timestamp: number;
  temp: number | null;
  humidity: number | null;
  light: number | null;
  rainAnalog: number | null;
  rainProb: number;
}

export interface SolarEphemerisResult {
  sunriseTime: string | null;      // Formatted "6:19 AM"
  sunsetTime: string | null;       // Formatted "6:26 PM"
  sunriseIso: string | null;       // "2026-09-22T06:19"
  sunsetIso: string | null;        // "2026-09-22T18:26"
  currentLocalTimeIso: string | null;
  isSunsetted: boolean;           // true if currentLocalTime >= sunset
  isBeforeSunrise: boolean;       // true if currentLocalTime < sunrise
  isSolarDaylight: boolean;       // true if between sunrise and sunset
  minutesUntilSunset: number | null;
  minutesSinceSunrise: number | null;
  dataAvailable: boolean;         // valid forecast sunrise/sunset strings found
}

function formatToAmPm(isoOrTimeStr: string | null | undefined): string | null {
  if (!isoOrTimeStr) return null;
  try {
    const timePart = isoOrTimeStr.includes('T') ? isoOrTimeStr.split('T')[1] : isoOrTimeStr;
    const [hStr, mStr] = timePart.split(':');
    const h = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    if (isNaN(h) || isNaN(m)) return null;
    const period = h >= 12 ? 'PM' : 'AM';
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return `${displayH}:${String(m).padStart(2, '0')} ${period}`;
  } catch {
    return null;
  }
}

export function calculateSolarEphemeris(weatherData: any, nowTimestamp: number = Date.now()): SolarEphemerisResult {
  if (!weatherData?.daily?.sunrise || !weatherData?.daily?.sunset) {
    return {
      sunriseTime: null,
      sunsetTime: null,
      sunriseIso: null,
      sunsetIso: null,
      currentLocalTimeIso: null,
      isSunsetted: false,
      isBeforeSunrise: false,
      isSolarDaylight: false,
      minutesUntilSunset: null,
      minutesSinceSunrise: null,
      dataAvailable: false,
    };
  }

  // Calculate local time at farm using utc_offset_seconds (defaults to 19800 = IST +5:30 for Karnataka/India)
  const offsetSeconds = typeof weatherData?.utc_offset_seconds === 'number' ? weatherData.utc_offset_seconds : 19800;
  const farmLocalDate = new Date(nowTimestamp + (offsetSeconds * 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const todayDateStr = `${farmLocalDate.getUTCFullYear()}-${pad(farmLocalDate.getUTCMonth() + 1)}-${pad(farmLocalDate.getUTCDate())}`;
  const currentLocalIso = `${todayDateStr}T${pad(farmLocalDate.getUTCHours())}:${pad(farmLocalDate.getUTCMinutes())}`;

  // Find today's specific index in daily array (Open-Meteo returns past_days=1, so index 0 is yesterday, index 1 is today!)
  const dailyTimes: string[] = Array.isArray(weatherData?.daily?.time) ? weatherData.daily.time : [];
  let dayIdx = dailyTimes.findIndex((t: string) => t.startsWith(todayDateStr));
  if (dayIdx === -1) {
    dayIdx = dailyTimes.length > 1 && weatherData?.past_days ? 1 : 0;
  }

  const sunriseRaw = weatherData?.daily?.sunrise?.[dayIdx] || weatherData?.daily?.sunrise?.[0];
  const sunsetRaw = weatherData?.daily?.sunset?.[dayIdx] || weatherData?.daily?.sunset?.[0];

  if (!sunriseRaw || !sunsetRaw || typeof sunriseRaw !== 'string' || typeof sunsetRaw !== 'string') {
    return {
      sunriseTime: null,
      sunsetTime: null,
      sunriseIso: null,
      sunsetIso: null,
      currentLocalTimeIso: currentLocalIso,
      isSunsetted: false,
      isBeforeSunrise: false,
      isSolarDaylight: false,
      minutesUntilSunset: null,
      minutesSinceSunrise: null,
      dataAvailable: false,
    };
  }

  // Time comparison using ISO format string (YYYY-MM-DDTHH:MM) against TODAY'S sunrise and sunset
  const isSunsetted = currentLocalIso >= sunsetRaw;
  const isBeforeSunrise = currentLocalIso < sunriseRaw;
  const isSolarDaylight = !isSunsetted && !isBeforeSunrise && (weatherData?.current?.is_day !== undefined ? weatherData.current.is_day === 1 : true);

  let minutesUntilSunset: number | null = null;
  let minutesSinceSunrise: number | null = null;
  try {
    const [curH, curM] = currentLocalIso.split('T')[1].split(':').map(Number);
    const [setH, setM] = sunsetRaw.includes('T') ? sunsetRaw.split('T')[1].split(':').map(Number) : [18, 25];
    const [riseH, riseM] = sunriseRaw.includes('T') ? sunriseRaw.split('T')[1].split(':').map(Number) : [6, 15];

    const curTotalM = curH * 60 + curM;
    const setTotalM = setH * 60 + setM;
    const riseTotalM = riseH * 60 + riseM;

    minutesUntilSunset = setTotalM - curTotalM;
    minutesSinceSunrise = curTotalM - riseTotalM;
  } catch {}

  return {
    sunriseTime: formatToAmPm(sunriseRaw),
    sunsetTime: formatToAmPm(sunsetRaw),
    sunriseIso: sunriseRaw,
    sunsetIso: sunsetRaw,
    currentLocalTimeIso: currentLocalIso,
    isSunsetted,
    isBeforeSunrise,
    isSolarDaylight,
    minutesUntilSunset,
    minutesSinceSunrise,
    dataAvailable: true,
  };
}

const rollingBuffer: TelemetryPoint[] = [];
const DATASET_DIR = path.join(process.cwd(), "data");
const DATASET_FILE = path.join(DATASET_DIR, "ml_dataset.json");

// Ensure dataset directory exists
try {
  if (!fs.existsSync(DATASET_DIR)) {
    fs.mkdirSync(DATASET_DIR, { recursive: true });
  }
} catch (e) {
  console.warn("[PredictionEngine] Could not initialize data directory:", e);
}

/**
 * 1. LOCAL SENSOR VALIDATION
 * Validates every sensor reading before allowing decision logic to consume it.
 * Strictly enforces: Missing or failed sensor data is NEVER interpreted as dry/safe!
 */
export function validateSensorTelemetry(
  sensor: SensorTelemetry | null,
  lastPacketTime: number,
  farmSettings: FarmSettings
): SensorValidationSummary {
  const now = Date.now();
  const staleTimeoutMs = (farmSettings.sensorStaleSeconds || 20) * 1000;
  const warnings: string[] = [];

  // Check connection status
  let esp32ConnectionStatus: 'ONLINE' | 'OFFLINE' | 'STALE' = 'OFFLINE';
  let lastSeenSeconds: number | null = null;

  if (lastPacketTime > 0) {
    const elapsed = now - lastPacketTime;
    lastSeenSeconds = Math.max(0, Math.round(elapsed / 1000));
    if (elapsed <= staleTimeoutMs) {
      esp32ConnectionStatus = 'ONLINE';
    } else {
      esp32ConnectionStatus = 'STALE';
      warnings.push(`Sensor telemetry stale (${lastSeenSeconds}s since last packet)`);
    }
  } else {
    warnings.push("No telemetry received from ESP32 drying bed controller");
  }

  if (!sensor) {
    return {
      dhtTempStatus: 'MISSING',
      dhtHumidityStatus: 'MISSING',
      rainSensorStatus: 'MISSING',
      lightSensorStatus: 'MISSING',
      esp32ConnectionStatus,
      lastSeenSeconds,
      allCriticalSensorsValid: false,
      validationWarnings: ["Hardware sensors offline or disconnected"],
    };
  }

  // 1. DHT22 Temperature Validation (-5°C to 65°C realistic drying range)
  let dhtTempStatus: SensorHealthStatus = 'VALID';
  if (!sensor.dht_connected || sensor.temperature === null || isNaN(sensor.temperature)) {
    dhtTempStatus = sensor.dht_connected ? 'MISSING' : 'DISCONNECTED';
    warnings.push("DHT22 temperature sensor disconnected or unreadable");
  } else if (sensor.temperature < -5 || sensor.temperature > 70) {
    dhtTempStatus = 'OUT_OF_RANGE';
    warnings.push(`DHT22 temp out of physical bounds (${sensor.temperature}°C)`);
  }

  // 2. DHT22 Humidity Validation (5% to 100%)
  let dhtHumidityStatus: SensorHealthStatus = 'VALID';
  if (!sensor.dht_connected || sensor.humidity === null || isNaN(sensor.humidity)) {
    dhtHumidityStatus = sensor.dht_connected ? 'MISSING' : 'DISCONNECTED';
    warnings.push("DHT22 humidity sensor disconnected or unreadable");
  } else if (sensor.humidity < 5 || sensor.humidity > 100) {
    dhtHumidityStatus = 'OUT_OF_RANGE';
    warnings.push(`DHT22 humidity out of bounds (${sensor.humidity}%)`);
  }

  // 3. Rain Sensor Plate Validation (Analog 0-4095, Digital 0 or 1)
  let rainSensorStatus: SensorHealthStatus = 'VALID';
  if (!sensor.rain_connected) {
    rainSensorStatus = 'DISCONNECTED';
    warnings.push("Rain detector plate disconnected from ESP32");
  } else if (sensor.rain_analog !== null && (sensor.rain_analog < 0 || sensor.rain_analog > 4095)) {
    rainSensorStatus = 'OUT_OF_RANGE';
    warnings.push(`Rain plate analog ADC out of range (${sensor.rain_analog})`);
  }

  // 4. LDR Light Sensor Validation (0-4095)
  let lightSensorStatus: SensorHealthStatus = 'VALID';
  if (!sensor.light_connected || sensor.light === null) {
    lightSensorStatus = 'DISCONNECTED';
    warnings.push("LDR sunlight sensor disconnected");
  } else if (sensor.light < 0 || sensor.light > 4095) {
    lightSensorStatus = 'OUT_OF_RANGE';
    warnings.push(`LDR light ADC out of range (${sensor.light})`);
  }

  // Critical sensors for tarpaulin safety: Rain plate & ESP32 connection
  const allCriticalSensorsValid =
    esp32ConnectionStatus === 'ONLINE' &&
    rainSensorStatus === 'VALID' &&
    dhtTempStatus !== 'OUT_OF_RANGE' &&
    dhtHumidityStatus !== 'OUT_OF_RANGE';

  return {
    dhtTempStatus,
    dhtHumidityStatus,
    rainSensorStatus,
    lightSensorStatus,
    esp32ConnectionStatus,
    lastSeenSeconds,
    allCriticalSensorsValid,
    validationWarnings: warnings,
  };
}

/**
 * 2. TREND & ROLLING BUFFER CALCULATIONS
 * Tracks continuous changes in local climate (humidity spikes, temperature drops, light fading)
 */
export function recordTelemetrySnapshot(
  sensor: SensorTelemetry | null,
  rainProb: number = 0
) {

  const now = Date.now();
  rollingBuffer.push({
    timestamp: now,
    temp: sensor?.dht_connected && sensor.temperature !== null ? sensor.temperature : null,
    humidity: sensor?.dht_connected && sensor.humidity !== null ? sensor.humidity : null,
    light: sensor?.light_connected && sensor.light !== null ? sensor.light : null,
    rainAnalog: sensor?.rain_connected && sensor.rain_analog !== null ? sensor.rain_analog : null,
    rainProb,
  });

  // Keep last 30 minutes of 5-second snapshots (~360 records)
  while (rollingBuffer.length > 360) {
    rollingBuffer.shift();
  }
}

export function compute5mTrends(): {
  tempTrend5m: number;
  humidityTrend5m: number;
  lightTrend5m: number;
  rainAnalogTrend5m: number;
  rainProbTrend5m: number;
} {
  if (rollingBuffer.length < 2) {
    return { tempTrend5m: 0, humidityTrend5m: 0, lightTrend5m: 0, rainAnalogTrend5m: 0, rainProbTrend5m: 0 };
  }

  const current = rollingBuffer[rollingBuffer.length - 1];
  const fiveMinAgoTime = current.timestamp - 300000; // 5 min ago

  // Find closest record ~5 min ago
  let past = rollingBuffer[0];
  for (let i = rollingBuffer.length - 1; i >= 0; i--) {
    if (rollingBuffer[i].timestamp <= fiveMinAgoTime) {
      past = rollingBuffer[i];
      break;
    }
  }

  const tempTrend5m = current.temp !== null && past.temp !== null ? Number((current.temp - past.temp).toFixed(2)) : 0;
  const humidityTrend5m = current.humidity !== null && past.humidity !== null ? Number((current.humidity - past.humidity).toFixed(2)) : 0;
  const lightTrend5m = current.light !== null && past.light !== null ? Number((current.light - past.light).toFixed(0)) : 0;
  const rainAnalogTrend5m = current.rainAnalog !== null && past.rainAnalog !== null ? Number((current.rainAnalog - past.rainAnalog).toFixed(0)) : 0;
  const rainProbTrend5m = Number((current.rainProb - past.rainProb).toFixed(1));

  return { tempTrend5m, humidityTrend5m, lightTrend5m, rainAnalogTrend5m, rainProbTrend5m };
}

/**
 * 3. RAIN PREDICTION ENGINE (SENSOR + WEATHER + 30 NEARBY LOCATIONS FUSION)
 */
export function calculateUnifiedRainPrediction(
  sensor: SensorTelemetry | null,
  validation: SensorValidationSummary,
  weatherData: any,
  spatial30: Spatial30LocationMetrics,
  farmSettings: FarmSettings
): UnifiedRainPrediction {
  const trends = compute5mTrends();
  const now = Date.now();

  // 1. Direct hardware rain plate check (HIGHEST PRIORITY EVIDENCE)
  // Configurable thresholds applied, including momentary verification
  const isPlateWet = Boolean(
    sensor &&
      sensor.rain_connected &&
      (sensor.rain ||
        sensor.rain_digital === 0 ||
        (sensor.rain_analog !== null && sensor.rain_analog < (farmSettings.rainAnalogThreshold || 2800)) ||
        sensor.verification_state === 'CONFIRMED_RAIN' ||
        sensor.verification_state === 'VERIFYING_RAIN')
  );

  // In INTERNET_ONLY mode, physical sensor data is completely bypassed
  const isForecastOnlyMode = farmSettings.decisionMode === 'INTERNET_ONLY';
  const isSensorOnlyMode = farmSettings.decisionMode === 'SENSOR_ONLY';
  const actual_rain = isForecastOnlyMode ? false : isPlateWet;
  const isLocalPlateBoneDry = Boolean(
    sensor &&
      sensor.rain_connected &&
      !sensor.rain &&
      (sensor.rain_analog === null || sensor.rain_analog >= 3000) &&
      (sensor.rain_digital === null || sensor.rain_digital === 1)
  );

  // Day/night status calculated:
  // In SENSOR_ONLY mode: night is strictly determined by physical LDR darkness (never by internet weather ephemeris)
  // In INTERNET_ONLY mode: solar ephemeris / forecast
  // In COMBO mode: solar ephemeris with LDR failover
  const solar = calculateSolarEphemeris(weatherData, now);
  const isDay = solar.dataAvailable 
    ? solar.isSolarDaylight 
    : (weatherData?.current?.is_day !== undefined ? weatherData.current.is_day === 1 : true);
  const rawLight = sensor?.light !== null && sensor?.light !== undefined ? parseInt(String(sensor.light), 10) : null;
  const isNightByLdr = rawLight !== null && rawLight > (farmSettings.nightDetectionThreshold || 3400);
  const isNightOrTwilight = isSensorOnlyMode
    ? isNightByLdr
    : (!isDay || (!isForecastOnlyMode && isNightByLdr));

  // Baseline satellite & radar variables (used by RF and fusion)
  const currentPrecip = weatherData?.current?.precipitation ?? 0;
  const currentPop = weatherData?.hourly?.precipitation_probability?.[0] ?? (currentPrecip > 0 ? 70 : 15);
  const cloudCover = weatherData?.current?.cloud_cover ?? 30;
  const nearbyWeightedRisk = spatial30.distanceWeightedNearbyRisk;

  // Extract Random Forest Feature Vector for ML Ensemble inference
  const rfFeatures = {
    temperature: sensor?.temperature ?? weatherData?.current?.temperature_2m ?? 29.5,
    humidity: sensor?.humidity ?? weatherData?.current?.relative_humidity_2m ?? 78.0,
    lightAdc: rawLight ?? 2200,
    rainAnalog: sensor?.rain_analog ?? (isPlateWet ? 1100 : 3800),
    currentRainProb: currentPop,
    currentPrecipitation: currentPrecip,
    currentCloudCover: cloudCover,
    nearbyWeightedRainProb: nearbyWeightedRisk,
    humidityTrend5m: trends.humidityTrend5m,
    tempTrend5m: trends.tempTrend5m,
    lightTrend5m: trends.lightTrend5m,
    actualRain: actual_rain ? 1 : 0,
  };
  const rfResult = randomForestModel.predict(rfFeatures);

  // If rain is physically hitting the plate right now -> 100% rain risk immediately (COMBO and SENSOR_ONLY modes)
  if (actual_rain && !isForecastOnlyMode) {
    return {
      rain_probability: 100,
      rain_risk: 'HIGH',
      actual_rain: true,
      prediction_horizon: "Immediate (Active)",
      prediction_reason: "Rain detected directly on drying bed sensor plate — overrides all forecasts (Priority #1)",
      prediction_confidence: 99,
      data_status: validation.allCriticalSensorsValid ? 'VALID' : 'DEGRADED',
      derived_features: {
        tempTrend5m: trends.tempTrend5m,
        humidityTrend5m: trends.humidityTrend5m,
        lightTrend5m: trends.lightTrend5m,
        rainAnalogTrend5m: trends.rainAnalogTrend5m,
        hourlyPrecipTrend: weatherData?.current?.precipitation ?? 0,
        isNightOrTwilight,
        rawLightAdc: rawLight,
        isLocalPlateBoneDry,
        sunriseTime: solar.sunriseTime,
        sunsetTime: solar.sunsetTime,
        isAfterSunset: solar.isSunsetted,
        isBeforeSunrise: solar.isBeforeSunrise,
        isSolarDaylight: solar.isSolarDaylight,
        solarDataAvailable: solar.dataAvailable,
      },
      randomForest: {
        modelType: "Random Forest Ensemble (35 Decision Trees)",
        nEstimators: rfResult.nEstimators,
        predictedOutcome: rfResult.predictedOutcome,
        rfRainProbability: 100,
        confidence: 99,
        treeVotes: rfResult.treeVotes,
        topFeatureContributors: rfResult.featureContributions,
        trainingDatasetSize: rfResult.datasetSize,
        modelAccuracy: rfResult.modelAccuracy,
      },
    };
  }

  // 2. Multi-feature fusion when sensor plate is currently dry
  let rainProb = 0;
  let reason = "";
  let confidence = 85;
  let dataStatus: PredictionDataStatus = 'VALID';

  // Weather API staleness check
  const weatherStaleMs = (farmSettings.weatherStaleMinutes || 15) * 60 * 1000;
  const weatherAgeMs = weatherData?.timestamp ? (now - weatherData.timestamp) : 0;
  const isWeatherStale = weatherAgeMs > weatherStaleMs || !weatherData?.current;

  if (isWeatherStale) {
    dataStatus = 'FALLBACK';
    confidence = 65;
  }

  // Baseline 2: 100km Regional Locations Evidence & 10km Critical Perimeter
  const isIsolatedSpike = spatial30.isIsolatedSpike;
  const spatialConsistency = spatial30.spatialConsistency;
  const is10kmClear = spatial30.is10kmPerimeterClear ?? (spatial30.nearestRainDistanceKm === null || spatial30.nearestRainDistanceKm > 10.0);

  // Fusion weighting:
  // - Current location weight: ~50%
  // - Distance-weighted regional locations: ~35%
  // - Local microclimate atmospheric trend: ~15%
  let fusedProb = (currentPop * 0.5) + (nearbyWeightedRisk * 0.35);

  const onlineProbThresh = farmSettings.onlineRainProbabilityThreshold || 30;
  const onlinePrecipThresh = farmSettings.onlinePrecipRateThreshold || 0.4;
  // Local active precipitation on ground or rain within 10km with high model probability
  const isOnlineRainAlert = (currentPrecip >= onlinePrecipThresh) || (!is10kmClear && currentPop >= onlineProbThresh);

  // Direct active rain on ground or 10km rain threat takes precedence
  if (isOnlineRainAlert) {
    fusedProb = Math.max(fusedProb, currentPop);
  }

  // Apply spatial consistency logic:
  // Mandate: "in 10km range no rain places are there then ok... show up to 100km for ref... instead of 30km, 10 is perfect... for previous logic..."
  if (spatialConsistency === 'STRONG_AGREEMENT_RAIN' && !is10kmClear) {
    fusedProb = Math.max(fusedProb, 65);
    reason = `Rain detected within 10km critical zone (${spatial30.nearestRainPlaceName || 'local area'} ~${spatial30.nearestRainDistanceKm}km); sealing canopy`;
  } else if (is10kmClear && (currentPrecip < 0.4 || isLocalPlateBoneDry)) {
    // 10km perimeter is clear and local plate is bone-dry! Safe for sun drying!
    fusedProb = Math.min(fusedProb, 20);
    if (spatial30.nearestRainPlaceName && spatial30.nearestRainDistanceKm !== null) {
      reason = `10km perimeter is clear of rain. Distant rain at ${spatial30.nearestRainPlaceName} (~${spatial30.nearestRainDistanceKm}km) monitored for reference; drying safe`;
    } else {
      reason = `10km perimeter and 100km regional radar are clear (regional avg risk ${spatial30.nearbyAverageRisk}%); optimal drying`;
    }
  } else if (isIsolatedSpike) {
    fusedProb = Math.min(fusedProb, 25);
    reason = `Isolated rain at distant location (${spatial30.nearestRainPlaceName || 'perimeter'}); local farm area remains dry`;
  } else if (spatialConsistency === 'CLEAR_DRY_CONSENSUS') {
    fusedProb = Math.min(fusedProb, 18);
    reason = `100km regional radar and current farm are clear (regional avg risk ${spatial30.nearbyAverageRisk}%)`;
  } else {
    reason = `10km perimeter clear. Extended 100km regional risk is ${nearbyWeightedRisk}% with ${spatial30.currentLocationRisk}% local radar risk`;
  }

  // Convective storm front trend modifier from local sensors (Only active in COMBO / SENSOR modes)
  if (!isForecastOnlyMode) {
    // Signature of sudden coastal rain: humidity jumps > 4% and temp drops > 1°C in 5 min
    if (trends.humidityTrend5m > 4 && trends.tempTrend5m < -1.0) {
      fusedProb += 15;
      reason += ` (Local convective signature: humidity rising +${trends.humidityTrend5m}%, temp dropping ${trends.tempTrend5m}°C)`;
    }

    // Pre-thunderstorm sudden darkness (light ADC increasing = darker)
    if (trends.lightTrend5m > 300 && isDay) {
      fusedProb += 10;
      reason += " (Sudden cloud darkening detected by LDR)";
    }
  }

  // Random Forest ML Ensemble Integration (Active in COMBO mode)
  // Blends Random Forest prediction (35 bagging decision trees) with multi-station spatial physics
  if (farmSettings.decisionMode === 'COMBO' && !is10kmClear) {
    // If regional radar shows active perimeter cells, RF weights increase
    fusedProb = (fusedProb * 0.55) + (rfResult.rfRainProbability * 0.45);
    if (rfResult.predictedOutcome === 'PREEMPTIVE_CLOSE') {
      reason += ` [Random Forest Ensemble (35 trees) predicts ${rfResult.predictedOutcome} with ${rfResult.confidence}% confidence]`;
    }
  } else if (farmSettings.decisionMode === 'COMBO') {
    // When 10km perimeter is clear, RF serves as an early-warning validator (30% weight)
    fusedProb = (fusedProb * 0.70) + (rfResult.rfRainProbability * 0.30);
  }

  rainProb = Math.min(100, Math.max(2, Math.round(fusedProb)));

  // Risk categorization
  const closeThresh = farmSettings.closeRainThreshold || 60;
  const openThresh = farmSettings.openRainThreshold || 30;

  let rainRisk: RainRiskLevel = 'LOW';
  if (rainProb >= closeThresh) {
    rainRisk = 'HIGH';
  } else if (rainProb >= openThresh) {
    rainRisk = 'MEDIUM';
  } else {
    rainRisk = 'LOW';
  }

  // If local sensors are degraded/missing, mark status
  if (!validation.allCriticalSensorsValid) {
    dataStatus = dataStatus === 'FALLBACK' ? 'FALLBACK' : 'DEGRADED';
    confidence = Math.min(confidence, 60);
  } else {
    // Confidence is reinforced by Random Forest tree vote consensus
    confidence = Math.min(99, Math.round((confidence * 0.5) + (rfResult.confidence * 0.5)));
  }

  return {
    rain_probability: rainProb,
    rain_risk: rainRisk,
    actual_rain: false,
    prediction_horizon: "Next 10–20 minutes",
    prediction_reason: reason,
    prediction_confidence: confidence,
    data_status: dataStatus,
    derived_features: {
      tempTrend5m: trends.tempTrend5m,
      humidityTrend5m: trends.humidityTrend5m,
      lightTrend5m: trends.lightTrend5m,
      rainAnalogTrend5m: trends.rainAnalogTrend5m,
      hourlyPrecipTrend: weatherData?.current?.precipitation ?? 0,
      isNightOrTwilight,
      rawLightAdc: rawLight,
      isLocalPlateBoneDry,
      sunriseTime: solar.sunriseTime,
      sunsetTime: solar.sunsetTime,
      isAfterSunset: solar.isSunsetted,
      isBeforeSunrise: solar.isBeforeSunrise,
      isSolarDaylight: solar.isSolarDaylight,
      solarDataAvailable: solar.dataAvailable,
    },
    randomForest: {
      modelType: "Random Forest Ensemble (35 Decision Trees)",
      nEstimators: rfResult.nEstimators,
      predictedOutcome: rfResult.predictedOutcome,
      rfRainProbability: rfResult.rfRainProbability,
      confidence: rfResult.confidence,
      treeVotes: rfResult.treeVotes,
      topFeatureContributors: rfResult.featureContributions,
      trainingDatasetSize: rfResult.datasetSize,
      modelAccuracy: rfResult.modelAccuracy,
    },
  };
}

/**
 * 4. FORECAST HORIZON ANALYSIS & RAIN RISK SCORE (0-100)
 * Evaluates Open-Meteo hourly variables over a 6-hour window:
 * - precipitation_probability, precipitation, rain, showers, cloud_cover,
 * - temperature_2m, relative_humidity_2m, shortwave_radiation, weather_code,
 * - wind_speed_10m, wind_gusts_10m
 */
export interface ForecastHorizonMetrics {
  rainRiskScore: number;                 // 0–100
  rainRiskClassification: 'CLEAR' | 'RAIN_WATCH' | 'RAIN_THREAT';
  currentPrecip: number;                 // mm
  currentRain: number;                   // mm
  currentShowers: number;                // mm
  currentCloudCover: number;             // %
  currentRadiation: number;              // W/m²
  currentTemp: number;                   // °C
  currentHumidity: number;               // %
  currentPop: number;                    // %
  maxPrecip6h: number;                   // mm
  maxPop6h: number;                      // %
  maxRain6h: number;                     // mm
  maxShowers6h: number;                  // mm
  maxWindGust6h: number;                 // km/h
  perimeter10kmRainThreat: number;       // 0–100
  hasSignificantNearTermRain: boolean;   // rain in next 30–60 min
  isLowRadiation: boolean;               // cloud >= 80% & radiation < 150 & rainRisk < 30
  nextHourPrecip: number;                // mm in next 30-60 min
  nextHourRain: number;                  // mm in next 30-60 min
  nextHourPop: number;                   // % in next 30-60 min
}

export function getCurrentHourIndex(weatherData: any, nowTimestamp: number = Date.now()): number {
  if (!weatherData?.hourly?.time || !Array.isArray(weatherData.hourly.time) || weatherData.hourly.time.length === 0) {
    return 0;
  }
  if (weatherData.current?.time) {
    const curHourPrefix = String(weatherData.current.time).substring(0, 13);
    const match = weatherData.hourly.time.findIndex((t: string) => t.startsWith(curHourPrefix));
    if (match !== -1) return match;
  }
  // Farm local time considering utc_offset_seconds (defaults to 19800 for IST +5:30)
  const offsetSeconds = typeof weatherData?.utc_offset_seconds === 'number' ? weatherData.utc_offset_seconds : 19800;
  const farmLocalDate = new Date(nowTimestamp + (offsetSeconds * 1000));
  const pad = (n: number) => String(n).padStart(2, '0');
  const localIsoHour = `${farmLocalDate.getUTCFullYear()}-${pad(farmLocalDate.getUTCMonth() + 1)}-${pad(farmLocalDate.getUTCDate())}T${pad(farmLocalDate.getUTCHours())}:00`;
  const idx = weatherData.hourly.time.findIndex((t: string) => t.startsWith(localIsoHour));
  if (idx !== -1) return idx;

  const curHour = farmLocalDate.getUTCHours();
  const pastDaysOffset = weatherData.hourly.time.length > 24 ? 24 : 0;
  return Math.min(curHour + pastDaysOffset, weatherData.hourly.time.length - 1);
}

export function computeForecastHorizonMetrics(
  weatherData: any,
  spatial30km?: Spatial30LocationMetrics,
  nowTimestamp: number = Date.now(),
  cfg: AutomationConfig = DEFAULT_AUTOMATION_CONFIG
): ForecastHorizonMetrics {
  const current = weatherData?.current;
  const hourly = weatherData?.hourly;
  const startIdx = getCurrentHourIndex(weatherData, nowTimestamp);
  const horizonHours = cfg.FORECAST_HORIZON_HOURS || 6;

  const endIdx = hourly?.time ? Math.min(startIdx + horizonHours, hourly.time.length) : 0;

  const precipProbs: number[] = [];
  const precipMm: number[] = [];
  const rainMm: number[] = [];
  const showersMm: number[] = [];
  const clouds: number[] = [];
  const radiations: number[] = [];
  const windGusts: number[] = [];

  for (let i = startIdx; i < endIdx; i++) {
    precipProbs.push(hourly.precipitation_probability?.[i] ?? 0);
    precipMm.push(hourly.precipitation?.[i] ?? 0);
    rainMm.push(hourly.rain?.[i] ?? 0);
    showersMm.push(hourly.showers?.[i] ?? 0);
    clouds.push(hourly.cloud_cover?.[i] ?? (current?.cloud_cover ?? 0));
    radiations.push(hourly.shortwave_radiation?.[i] ?? (current?.shortwave_radiation ?? 400));
    windGusts.push(hourly.wind_gusts_10m?.[i] ?? (current?.wind_gusts_10m ?? 0));
  }

  // Current immediate hour values
  const currentPrecip = current?.precipitation ?? precipMm[0] ?? 0;
  const currentRain = current?.rain ?? rainMm[0] ?? 0;
  const currentShowers = current?.showers ?? showersMm[0] ?? 0;
  const currentCloudCover = current?.cloud_cover ?? clouds[0] ?? 0;
  const currentRadiation = current?.shortwave_radiation ?? radiations[0] ?? 400;
  const currentTemp = current?.temperature_2m ?? (hourly?.temperature_2m?.[startIdx] ?? 30);
  const currentHumidity = current?.relative_humidity_2m ?? (hourly?.relative_humidity_2m?.[startIdx] ?? 70);
  const currentPop = precipProbs[0] ?? (currentPrecip > 0 ? 80 : 10);

  // Peak 6-hour projections
  const maxPrecip6h = precipMm.length > 0 ? Math.max(...precipMm) : currentPrecip;
  const maxPop6h = precipProbs.length > 0 ? Math.max(...precipProbs) : currentPop;
  const maxRain6h = rainMm.length > 0 ? Math.max(...rainMm) : currentRain;
  const maxShowers6h = showersMm.length > 0 ? Math.max(...showersMm) : currentShowers;
  const maxWindGust6h = windGusts.length > 0 ? Math.max(...windGusts) : (current?.wind_gusts_10m ?? 0);

  // Next 1–2 hours peak
  const maxPop2h = precipProbs.length > 1 ? Math.max(precipProbs[0], precipProbs[1]) : currentPop;

  // 10 km perimeter rain threat score (0–100)
  let perimeter10kmRainThreat = 0;
  if (spatial30km) {
    if (!spatial30km.is10kmPerimeterClear || (spatial30km.nearestRainDistanceKm !== null && spatial30km.nearestRainDistanceKm <= 10.0)) {
      const dist = spatial30km.nearestRainDistanceKm ?? 5.0;
      perimeter10kmRainThreat = Math.max(60, Math.min(100, Math.round(100 - dist * 4)));
    } else {
      perimeter10kmRainThreat = Math.min(25, Math.round((spatial30km.distanceWeightedNearbyRisk || 15) * 0.4));
    }
  }

  // Calculate Rain Risk Score (0–100)
  let rainRiskScore = 0;
  if (currentPrecip >= cfg.SIGNIFICANT_PRECIPITATION_MM || currentRain > 0 || currentShowers > 0) {
    rainRiskScore = Math.max(80, Math.min(100, Math.round(Math.max(currentPop, 80))));
  } else if (perimeter10kmRainThreat >= cfg.RAIN_CLOSE_THRESHOLD) {
    rainRiskScore = Math.max(65, Math.min(100, Math.round(currentPop * 0.35 + perimeter10kmRainThreat * 0.65)));
  } else {
    let blend = (currentPop * 0.40) + (maxPop2h * 0.30) + (maxPop6h * 0.15) + (perimeter10kmRainThreat * 0.15);
    if (maxPrecip6h >= cfg.SIGNIFICANT_PRECIPITATION_MM && maxPop6h >= 60) {
      blend = Math.max(blend, 65);
    }
    if (perimeter10kmRainThreat < cfg.RAIN_WATCH_THRESHOLD && currentPrecip < 0.2 && maxPop2h < 25) {
      blend = Math.min(blend, 25);
    }
    rainRiskScore = Math.min(100, Math.max(0, Math.round(blend)));
  }

  let rainRiskClassification: 'CLEAR' | 'RAIN_WATCH' | 'RAIN_THREAT' = 'CLEAR';
  if (rainRiskScore >= cfg.RAIN_CLOSE_THRESHOLD) {
    rainRiskClassification = 'RAIN_THREAT';
  } else if (rainRiskScore >= cfg.RAIN_WATCH_THRESHOLD) {
    rainRiskClassification = 'RAIN_WATCH';
  } else {
    rainRiskClassification = 'CLEAR';
  }

  // Next 30–60 minutes near-term rain forecast check
  const nextHourPrecip = precipMm[1] ?? 0;
  const nextHourRain = rainMm[1] ?? 0;
  const nextHourShowers = showersMm[1] ?? 0;
  const nextHourPop = precipProbs[1] ?? 0;

  // Immediate significant rain in next 30-60 minutes:
  // - immediate forecast precipitation >= 1.0 mm (cfg.SIGNIFICANT_PRECIPITATION_MM)
  // - OR rain probability >= 70% with rain/precipitation in the immediate window
  const hasSignificantNearTermRain =
    nextHourPrecip >= (cfg.SIGNIFICANT_PRECIPITATION_MM ?? 1.0) ||
    (nextHourPop >= 70 && (nextHourPrecip > 0 || nextHourRain > 0));

  // Low radiation classification condition
  const isLowRadiation =
    currentCloudCover >= cfg.HEAVY_CLOUD_THRESHOLD &&
    currentRadiation < cfg.LOW_SOLAR_RADIATION_WM2 &&
    rainRiskScore < cfg.RAIN_WATCH_THRESHOLD;

  return {
    rainRiskScore,
    rainRiskClassification,
    currentPrecip,
    currentRain,
    currentShowers,
    currentCloudCover,
    currentRadiation,
    currentTemp,
    currentHumidity,
    currentPop,
    maxPrecip6h,
    maxPop6h,
    maxRain6h,
    maxShowers6h,
    maxWindGust6h,
    perimeter10kmRainThreat,
    hasSignificantNearTermRain,
    isLowRadiation,
    nextHourPrecip,
    nextHourRain,
    nextHourPop,
  };
}

/**
 * 5. CONTROL DECISION ENGINE WITH 3 INDEPENDENT OPERATING MODES
 * 
 * - MODE 1: SENSORS MODE (Hardware only: ESP32 status, rain plate, LDR 50%-60% hysteresis)
 * - MODE 2: FORECAST MODE (Internet only: 6h Open-Meteo horizon, Rain Risk 0-100, low radiation check)
 * - MODE 3: COMBINED MODE (Primary intelligent mode: Priority safety fusion, 10m post-rain delay)
 */
export function evaluateControlDecision(
  currentCanopyState: CanopyMode,
  currentPhysicalPosition: 'OPEN' | 'CLOSED' | 'OPENING' | 'CLOSING' | 'STOPPED',
  prediction: UnifiedRainPrediction,
  validation: SensorValidationSummary,
  heaterState: HeaterDryerState,
  farmSettings: FarmSettings,
  spatial30km?: Spatial30LocationMetrics,
  currentWeather?: any,
  weatherForecast?: any,
  lastRainTimestamp: number = 0,
  sensor?: SensorTelemetry | null
): {
  target: 'OPEN' | 'CLOSED';
  actionTaken: boolean;
  reason: string;
  isSafeDryingPermitted: boolean;
  systemMode: SystemOperatingMode;
  systemModeReason: string;
} {
  // PRIORITY 0A: Emergency Stop Lockout (Absolute Highest Priority)
  // When STOP is active, motor is completely terminated and CANNOT move under any circumstances.
  if (currentCanopyState === 'STOPPED') {
    return {
      target: currentPhysicalPosition === 'OPEN' ? 'OPEN' : 'CLOSED',
      actionTaken: false,
      reason: "EMERGENCY STOPPED by operator — motor is completely terminated until START is pressed",
      isSafeDryingPermitted: false,
      systemMode: 'SAFE_CLOSED',
      systemModeReason: "Emergency Stop active: Motor completely terminated",
    };
  }

  // PRIORITY 0B: Manual Operator Overrides
  if (currentCanopyState === 'OPEN') {
    return {
      target: 'OPEN',
      actionTaken: currentPhysicalPosition !== 'OPEN' && currentPhysicalPosition !== 'OPENING',
      reason: "Manual Override: OPEN commanded by operator",
      isSafeDryingPermitted: true,
      systemMode: 'NORMAL',
      systemModeReason: "Manual OPEN override active",
    };
  }

  if (currentCanopyState === 'CLOSED') {
    return {
      target: 'CLOSED',
      actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
      reason: "Manual Override: CLOSED commanded by operator",
      isSafeDryingPermitted: false,
      systemMode: 'NORMAL',
      systemModeReason: "Manual CLOSED override active",
    };
  }

  // PRIORITY 0C: 12V Heater & Hot-Air Dryer Insulation Sealing
  if (heaterState.status === 'HEATING' && farmSettings.heaterAutoCloseSheet) {
    const reason = `12V Dryer Active: Chamber sealed at ${heaterState.activeSeconds}s to insulate drying bed`;
    return {
      target: 'CLOSED',
      actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
      reason,
      isSafeDryingPermitted: false,
      systemMode: 'NORMAL',
      systemModeReason: "12V hot-air chamber insulated",
    };
  }

  const cfg = getEffectiveAutomationConfig(farmSettings);
  const decMode: DecisionMode = farmSettings.decisionMode || 'COMBO';
  const now = Date.now();

  // Extract or calculate solar ephemeris (Sunrise / Sunset times and state)
  const solar = weatherForecast
    ? calculateSolarEphemeris(weatherForecast, now)
    : {
        sunriseTime: prediction?.derived_features?.sunriseTime ?? null,
        sunsetTime: prediction?.derived_features?.sunsetTime ?? null,
        sunriseIso: null,
        sunsetIso: null,
        currentLocalTimeIso: null,
        isSunsetted: Boolean(prediction?.derived_features?.isAfterSunset),
        isBeforeSunrise: Boolean(prediction?.derived_features?.isBeforeSunrise),
        isSolarDaylight: Boolean(prediction?.derived_features?.isSolarDaylight),
        minutesUntilSunset: null,
        minutesSinceSunrise: null,
        dataAvailable: Boolean(prediction?.derived_features?.solarDataAvailable),
      };

  // Physical LDR light sensor percentage calculation (0-100%)
  const rawLight = typeof prediction?.derived_features?.rawLightAdc === 'number'
    ? prediction.derived_features.rawLightAdc
    : (sensor?.light ?? null);

  const minAdc = farmSettings.sunlightMinAdc ?? 150;
  const maxAdc = farmSettings.sunlightMaxAdc ?? 4095;
  const sunPct = rawLight !== null
    ? Math.max(0, Math.min(100, Math.round(((maxAdc - rawLight) / (maxAdc - minAdc)) * 100)))
    : null;

  // Forecast Horizon metrics (Rain Risk 0-100 over 6 hours)
  const forecastMetrics = computeForecastHorizonMetrics(
    weatherForecast || { current: currentWeather },
    spatial30km,
    now,
    cfg
  );
  const rainRiskScore = typeof prediction?.rain_risk_score === 'number'
    ? prediction.rain_risk_score
    : forecastMetrics.rainRiskScore;

  // =========================================================================
  // MODE 1: SENSORS MODE (Hardware Only)
  // DO NOT use: Open-Meteo, Internet forecast, Rain probability, Cloud cover, Weather API, Sunrise/sunset
  // Use ONLY: ESP32 online status, Rain sensor plate, LDR
  // LDR_OPEN_THRESHOLD = 60%, LDR_CLOSE_THRESHOLD = 50%
  // =========================================================================
  if (decMode === 'SENSOR_ONLY') {
    // IF ESP32/hardware is offline -> SAFE CLOSED
    const isHardwareOffline = !validation.allCriticalSensorsValid || validation.esp32ConnectionStatus !== 'ONLINE';
    if (isHardwareOffline) {
      return {
        target: 'CLOSED',
        actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
        reason: `Sensors Mode: ESP32 hardware is offline (${validation.validationWarnings.join('; ') || 'offline'}) — SAFE CLOSED`,
        isSafeDryingPermitted: false,
        systemMode: 'SAFE_CLOSED',
        systemModeReason: "Hardware offline",
      };
    }

    // ELSE IF rain sensor plate = WET -> IMMEDIATE CLOSE
    const isPlateWet = Boolean(
      prediction.actual_rain ||
      (sensor && sensor.rain_connected && (
        sensor.rain ||
        (sensor.rain_analog !== null && sensor.rain_analog < (farmSettings.rainAnalogThreshold || 2800)) ||
        sensor.verification_state === 'CONFIRMED_RAIN' ||
        sensor.verification_state === 'VERIFYING_RAIN'
      ))
    );

    if (isPlateWet) {
      return {
        target: 'CLOSED',
        actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
        reason: "Sensors Mode: Rain sensor plate WET — IMMEDIATE CLOSE",
        isSafeDryingPermitted: false,
        systemMode: 'NORMAL',
        systemModeReason: "Hardware rain plate wet",
      };
    }

    const isCurrentlyOpen = currentPhysicalPosition === 'OPEN' || currentPhysicalPosition === 'OPENING';
    const ldrPct = sunPct ?? 0;

    // ELSE IF tarpaulin is currently OPEN:
    //   IF LDR < 50% -> CLOSE
    //   ELSE -> KEEP OPEN
    if (isCurrentlyOpen) {
      if (ldrPct < cfg.LDR_CLOSE_THRESHOLD) {
        return {
          target: 'CLOSED',
          actionTaken: true,
          reason: `Sensors Mode: LDR sunlight ${ldrPct}% < ${cfg.LDR_CLOSE_THRESHOLD}% — CLOSE`,
          isSafeDryingPermitted: false,
          systemMode: 'NORMAL',
          systemModeReason: "LDR sunlight below close threshold",
        };
      } else {
        return {
          target: 'OPEN',
          actionTaken: false,
          reason: `Sensors Mode: LDR sunlight ${ldrPct}% >= ${cfg.LDR_CLOSE_THRESHOLD}% & rain plate DRY — KEEP OPEN`,
          isSafeDryingPermitted: true,
          systemMode: 'NORMAL',
          systemModeReason: "LDR detects light & dry",
        };
      }
    } else {
      // ELSE IF tarpaulin is currently CLOSED:
      //   IF LDR > 60% AND rain sensor = DRY -> OPEN
      //   ELSE -> KEEP CLOSED
      if (ldrPct > cfg.LDR_OPEN_THRESHOLD && !isPlateWet) {
        return {
          target: 'OPEN',
          actionTaken: true,
          reason: `Sensors Mode: LDR sunlight ${ldrPct}% > ${cfg.LDR_OPEN_THRESHOLD}% & rain sensor DRY — OPEN for solar drying`,
          isSafeDryingPermitted: true,
          systemMode: 'NORMAL',
          systemModeReason: "LDR above open threshold & dry",
        };
      } else {
        return {
          target: 'CLOSED',
          actionTaken: false,
          reason: `Sensors Mode: LDR sunlight ${ldrPct}% <= ${cfg.LDR_OPEN_THRESHOLD}% — KEEP CLOSED`,
          isSafeDryingPermitted: false,
          systemMode: 'NORMAL',
          systemModeReason: "LDR below open threshold",
        };
      }
    }
  }

  // =========================================================================
  // MODE 2: FORECAST MODE (Internet / Forecast Only)
  // Do not use local rain sensor or LDR as weather decision inputs.
  // Forecast horizon: 6 hours, Refresh interval: 10 minutes.
  // Rain Risk Score: 0-100 (0-29 CLEAR, 30-59 RAIN WATCH, 60-100 RAIN THREAT).
  //
  // FINAL DECISION PRIORITY ORDER:
  // 1. NIGHT -> CLOSE
  // 2. CURRENT PRECIPITATION / CURRENT RAIN -> CLOSE
  // 3. IMMEDIATE SIGNIFICANT RAIN (next 30-60 min) -> CLOSE
  // 4. HIGH RAIN THREAT (Rain Risk >= 60 OR 10km threat >= 60) -> CLOSE
  // 5. SAFE CURRENT CONDITIONS (Daylight + Rain Risk < 30 + rain=0 + precip<0.5mm + 10km<30 + solar rad >= 150) -> AUTONOMOUS OPEN
  // 6. RAIN WATCH (Rain Risk 30-59):
  //    - If currently OPEN & conditions safe: HOLD OPEN ("RAIN WATCH — HOLDING OPEN")
  //    - If currently CLOSED & conditions safe: OPEN / RECOVER ("RAIN WATCH — SAFE RECOVERY — OPENING")
  //    - If conditions unsafe: HOLD CLOSED
  // =========================================================================
  if (decMode === 'INTERNET_ONLY') {
    // Fail-safe: Forecast unavailable
    if (!weatherForecast && !currentWeather) {
      return {
        target: currentPhysicalPosition === 'OPEN' ? 'OPEN' : 'CLOSED',
        actionTaken: false,
        reason: "FORECAST UNAVAILABLE",
        isSafeDryingPermitted: false,
        systemMode: 'LOCAL_FALLBACK',
        systemModeReason: "FORECAST UNAVAILABLE",
      };
    }

    // 1. NIGHT -> CLOSE
    const isNighttime = solar.dataAvailable
      ? (solar.isSunsetted || solar.isBeforeSunrise)
      : (currentWeather?.is_day === 0);

    if (isNighttime) {
      const timeReason = solar.isSunsetted
        ? `Sunset passed (${solar.sunsetTime || 'night'})`
        : `Pre-dawn darkness (Sunrise at ${solar.sunriseTime || 'dawn'})`;
      return {
        target: 'CLOSED',
        actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
        reason: `Forecast Mode: Nighttime active (${timeReason}) — AUTONOMOUS CLOSE for dew protection`,
        isSafeDryingPermitted: false,
        systemMode: 'NORMAL',
        systemModeReason: "Nighttime dew protection",
      };
    }

    const isDaylight = !isNighttime;
    const curPrecip = (currentWeather?.precipitation ?? forecastMetrics.currentPrecip) ?? 0;
    const curRain = (currentWeather?.rain ?? forecastMetrics.currentRain) ?? 0;
    const curShowers = (currentWeather?.showers ?? forecastMetrics.currentShowers) ?? 0;
    const curRadiation = currentWeather?.shortwave_radiation ?? forecastMetrics.currentRadiation;
    const perimThreat = forecastMetrics.perimeter10kmRainThreat;

    // 2. CURRENT PRECIPITATION / CURRENT RAIN -> CLOSE immediately
    if (curPrecip > 0 || curRain > 0 || curShowers > 0) {
      let rainReason = "";
      if (curRain > 0) {
        rainReason = `Active rain falling (${curRain} mm)`;
      } else if (curPrecip > 0) {
        rainReason = `Current precipitation ${curPrecip} mm`;
      } else {
        rainReason = `Active showers detected (${curShowers} mm)`;
      }
      return {
        target: 'CLOSED',
        actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
        reason: `Forecast Mode: ${rainReason} — AUTONOMOUS CLOSE`,
        isSafeDryingPermitted: false,
        systemMode: 'NORMAL',
        systemModeReason: "Current rain event active",
      };
    }

    // 3. IMMEDIATE SIGNIFICANT RAIN (Immediate forecast precipitation >= 1.0mm OR pop >= 70% with rain) -> CLOSE
    const isImmediateSignificantRain =
      forecastMetrics.nextHourPrecip >= cfg.SIGNIFICANT_PRECIPITATION_MM ||
      (forecastMetrics.nextHourPop >= 70 && (forecastMetrics.nextHourPrecip > 0 || forecastMetrics.nextHourRain > 0));

    if (isImmediateSignificantRain) {
      const immReason = forecastMetrics.nextHourPrecip >= cfg.SIGNIFICANT_PRECIPITATION_MM
        ? `Immediate forecast precipitation ${forecastMetrics.nextHourPrecip} mm >= ${cfg.SIGNIFICANT_PRECIPITATION_MM} mm in next 10–20 minutes`
        : `Immediate rain probability ${forecastMetrics.nextHourPop}% >= 70% with rain forecast in next 10–20 minutes`;
      return {
        target: 'CLOSED',
        actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
        reason: `Forecast Mode: ${immReason} — AUTONOMOUS CLOSE`,
        isSafeDryingPermitted: false,
        systemMode: 'NORMAL',
        systemModeReason: "Immediate significant rain forecast",
      };
    }

    // 4. HIGH RAIN THREAT (Rain Risk >= 60 OR 10 km perimeter threat >= 60) -> CLOSE
    const isRainThreat = rainRiskScore >= cfg.RAIN_CLOSE_THRESHOLD; // >= 60
    const isPerimeterThreat = perimThreat >= cfg.RAIN_CLOSE_THRESHOLD; // >= 60

    if (isRainThreat || isPerimeterThreat) {
      let threatReason = "";
      if (isRainThreat) {
        const primaryDriver = forecastMetrics.currentPop >= 60 
          ? `Precipitation probability at ${forecastMetrics.currentPop}%` 
          : forecastMetrics.maxPop6h >= 60 
          ? `Radar 6h outlook predicts ${forecastMetrics.maxPop6h}% rain chance`
          : perimThreat >= 50
          ? `Regional radar shows rain bands within 10 km`
          : `Atmospheric moisture and cloud buildup (${forecastMetrics.currentCloudCover}% cover)`;
        threatReason = `Forecast Rain Risk score is ${rainRiskScore}/100 (exceeds ${cfg.RAIN_CLOSE_THRESHOLD}% safety threshold). ${primaryDriver}. Tarpal sealed autonomously to protect drying arecanuts from moisture damage`;
      } else {
        threatReason = `10 km perimeter weather radar detected rain cells approaching (threat index ${perimThreat}/100 >= ${cfg.RAIN_CLOSE_THRESHOLD}). Preemptive seal engaged`;
      }
      return {
        target: 'CLOSED',
        actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
        reason: `Forecast Mode: ${threatReason}`,
        isSafeDryingPermitted: false,
        systemMode: 'NORMAL',
        systemModeReason: "High forecast rain threat",
      };
    }

    // LOW-RADIATION condition (Cloud cover alone must never close without this full condition):
    // IF cloud_cover >= 80% AND shortwave_radiation < 150 W/m² AND Rain Risk < 30
    // -> classify as LOW SOLAR RADIATION (never classify as rain)
    const isLowRadiation =
      (currentWeather?.cloud_cover ?? forecastMetrics.currentCloudCover) >= cfg.HEAVY_CLOUD_THRESHOLD &&
      curRadiation < cfg.LOW_SOLAR_RADIATION_WM2 &&
      rainRiskScore < cfg.RAIN_WATCH_THRESHOLD;

    if (isLowRadiation) {
      return {
        target: 'CLOSED',
        actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
        reason: `Forecast Mode: LOW SOLAR RADIATION (Cloud cover ${currentWeather?.cloud_cover ?? forecastMetrics.currentCloudCover}% >= ${cfg.HEAVY_CLOUD_THRESHOLD}%, solar irradiance ${Math.round(curRadiation)} W/m² < ${cfg.LOW_SOLAR_RADIATION_WM2} W/m²) — insufficient solar drying`,
        isSafeDryingPermitted: false,
        systemMode: 'NORMAL',
        systemModeReason: "LOW SOLAR RADIATION",
      };
    }

    // Determine if current environmental conditions are safe for solar drying:
    // Daylight = TRUE
    // current precipitation = 0
    // current rain = 0
    // 10 km perimeter threat < 30
    // shortwave radiation >= 150 W/m²
    // no immediate significant rain event in next 30-60 minutes
    const isAdequateRadiation = curRadiation >= cfg.LOW_SOLAR_RADIATION_WM2;
    const isCurrentlySafeForDrying =
      isDaylight &&
      curRain === 0 &&
      curPrecip === 0 &&
      perimThreat < cfg.RAIN_WATCH_THRESHOLD &&
      isAdequateRadiation &&
      !isImmediateSignificantRain;

    // 5. SAFE CURRENT CONDITIONS (Rain Risk < 30 & current parameters safe) -> AUTONOMOUS OPEN
    if (rainRiskScore < cfg.RAIN_WATCH_THRESHOLD) {
      if (isCurrentlySafeForDrying) {
        const timeWin = (solar.sunriseTime && solar.sunsetTime) ? ` (${solar.sunriseTime} to ${solar.sunsetTime})` : '';
        return {
          target: 'OPEN',
          actionTaken: currentPhysicalPosition !== 'OPEN' && currentPhysicalPosition !== 'OPENING',
          reason: `Forecast Mode: Daylight active${timeWin}, Rain Risk ${rainRiskScore} (< ${cfg.RAIN_WATCH_THRESHOLD}), precip 0mm & 10km perimeter clear — AUTONOMOUS OPEN`,
          isSafeDryingPermitted: true,
          systemMode: 'NORMAL',
          systemModeReason: "Forecast parameters verified safe for solar drying",
        };
      }
    }

    // 6. RAIN WATCH (Rain Risk 30–59 band)
    // Evaluate recovery / current conditions:
    // CASE A: Currently OPEN & conditions safe -> KEEP OPEN ("RAIN WATCH — HOLDING OPEN")
    // CASE B: Currently CLOSED & conditions safe -> OPEN / RECOVER ("RAIN WATCH — SAFE RECOVERY — OPENING")
    // IF conditions unsafe -> KEEP CLOSED
    const isCurrentlyOpen = currentPhysicalPosition === 'OPEN' || currentPhysicalPosition === 'OPENING';

    if (isCurrentlySafeForDrying) {
      if (isCurrentlyOpen) {
        return {
          target: 'OPEN',
          actionTaken: false,
          reason: "RAIN WATCH — HOLDING OPEN",
          isSafeDryingPermitted: true,
          systemMode: 'NORMAL',
          systemModeReason: "RAIN WATCH — safe conditions holding open",
        };
      } else {
        // Recovery from CLOSED state
        return {
          target: 'OPEN',
          actionTaken: true,
          reason: "RAIN WATCH — SAFE RECOVERY — OPENING",
          isSafeDryingPermitted: true,
          systemMode: 'NORMAL',
          systemModeReason: "RAIN WATCH — safe recovery opening",
        };
      }
    } else {
      // Current conditions are unsafe or insufficient radiation
      return {
        target: 'CLOSED',
        actionTaken: isCurrentlyOpen,
        reason: `Forecast Mode: RAIN WATCH (Rain Risk ${rainRiskScore}/100) — conditions unsafe for recovery — HOLD CLOSED`,
        isSafeDryingPermitted: false,
        systemMode: 'NORMAL',
        systemModeReason: "RAIN WATCH — holding closed due to marginal conditions",
      };
    }
  }

  // =========================================================================
  // MODE 3: COMBINED MODE (Primary Intelligent Mode)
  // Priority Order:
  // PRIORITY 1: LOCAL RAIN SENSOR
  // PRIORITY 2: FORECAST RAIN THREAT
  // PRIORITY 3: DAY/NIGHT
  // PRIORITY 4: SUNLIGHT / DRYING CONDITION
  // =========================================================================

  // Fail-Safe: Critical sensor state cannot be determined
  if (!validation.allCriticalSensorsValid) {
    return {
      target: 'CLOSED',
      actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
      reason: `Combined Mode: Critical sensor state cannot be determined (${validation.validationWarnings.join('; ')}) — SAFE CLOSED`,
      isSafeDryingPermitted: false,
      systemMode: 'SAFE_CLOSED',
      systemModeReason: "Critical sensor fault",
    };
  }

  // PRIORITY 1: LOCAL RAIN SENSOR
  // IF local rain sensor = WET -> IMMEDIATE CLOSE
  // Do not wait for Open-Meteo. Do not wait for forecast confirmation.
  const isLocalRainWet = Boolean(
    prediction.actual_rain ||
    (sensor && sensor.rain_connected && (
      sensor.rain ||
      (sensor.rain_analog !== null && sensor.rain_analog < (farmSettings.rainAnalogThreshold || 2800)) ||
      sensor.verification_state === 'CONFIRMED_RAIN' ||
      sensor.verification_state === 'VERIFYING_RAIN'
    ))
  );

  if (isLocalRainWet) {
    return {
      target: 'CLOSED',
      actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
      reason: "Combined Mode Priority #1: Local rain sensor WET — IMMEDIATE CLOSE",
      isSafeDryingPermitted: false,
      systemMode: 'NORMAL',
      systemModeReason: "Local rain sensor wet",
    };
  }

  // Post-rain hysteresis check:
  // Require rain sensor = DRY continuously for at least 10 minutes AND Rain Risk <= 30
  // AND no significant rain forecast for next 30–60 minutes before reopening.
  const msSinceLastRain = now - lastRainTimestamp;
  const requiredDryDelayMs = (cfg.RAIN_REOPEN_DELAY_MINUTES || 10) * 60 * 1000;
  if (lastRainTimestamp > 0 && msSinceLastRain < requiredDryDelayMs) {
    const minRemaining = Math.ceil((requiredDryDelayMs - msSinceLastRain) / 60000);
    return {
      target: 'CLOSED',
      actionTaken: false,
      reason: `Combined Mode: Post-rain drying stabilization — rain sensor must remain dry continuously for ${cfg.RAIN_REOPEN_DELAY_MINUTES} min (${minRemaining}m remaining before reopening)`,
      isSafeDryingPermitted: false,
      systemMode: 'NORMAL',
      systemModeReason: "Post-rain drying delay active",
    };
  }

  // PRIORITY 2: FORECAST RAIN THREAT (Preemptive Rain)
  // IF: local rain sensor = DRY AND
  // (Rain Risk >= 60 OR (rain probability >= 70% AND precipitation >= 1.0 mm) OR 10 km rain threat >= 60)
  // -> PREEMPTIVE CLOSE
  const isHighPopHighPrecip = (forecastMetrics.currentPop >= 70 && forecastMetrics.currentPrecip >= cfg.SIGNIFICANT_PRECIPITATION_MM);
  const isPreemptiveRain = (rainRiskScore >= cfg.RAIN_CLOSE_THRESHOLD) ||
                           isHighPopHighPrecip ||
                           (forecastMetrics.perimeter10kmRainThreat >= cfg.RAIN_CLOSE_THRESHOLD);

  if (isPreemptiveRain) {
    let preReason = "";
    if (rainRiskScore >= cfg.RAIN_CLOSE_THRESHOLD) {
      const primaryDriver = forecastMetrics.currentPop >= 60 
        ? `Precipitation probability at ${forecastMetrics.currentPop}%` 
        : forecastMetrics.maxPop6h >= 60 
        ? `Radar 6h outlook predicts ${forecastMetrics.maxPop6h}% rain chance`
        : forecastMetrics.perimeter10kmRainThreat >= 50
        ? `Regional radar shows rain bands within 10 km`
        : `Atmospheric moisture buildup (${forecastMetrics.currentCloudCover}% cloud cover)`;
      preReason = `Rain Risk score is ${rainRiskScore}/100 (exceeds ${cfg.RAIN_CLOSE_THRESHOLD}% safety threshold). ${primaryDriver}. Tarpal sealed preemptively to prevent crop dampening`;
    } else if (isHighPopHighPrecip) {
      preReason = `Incoming rain detected: ${forecastMetrics.currentPop}% rain probability with forecasted precipitation rate ${forecastMetrics.currentPrecip} mm/h. Preemptive seal engaged`;
    } else if (forecastMetrics.perimeter10kmRainThreat >= cfg.RAIN_CLOSE_THRESHOLD) {
      preReason = `Weather radar detected active rain cells within 10 km perimeter (threat index ${forecastMetrics.perimeter10kmRainThreat}/100 >= ${cfg.RAIN_CLOSE_THRESHOLD}). Preemptive seal engaged`;
    }

    return {
      target: 'CLOSED',
      actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
      reason: `Combined Mode Priority #2: ${preReason}`,
      isSafeDryingPermitted: false,
      systemMode: 'NORMAL',
      systemModeReason: "Preemptive rain threat",
    };
  }

  // PRIORITY 3: DAY/NIGHT
  // After sunset OR before sunrise -> CLOSE
  // Use astronomical sunrise/sunset as primary day/night information. LDR darkness as failover.
  let isNight = false;
  let nightReason = "";
  const isNightByLdr = rawLight !== null && rawLight > (farmSettings.nightDetectionThreshold || 3400);

  if (solar.dataAvailable) {
    if (solar.isSunsetted) {
      isNight = true;
      nightReason = `Sunset has occurred (${solar.sunsetTime})`;
    } else if (solar.isBeforeSunrise) {
      isNight = true;
      nightReason = `Pre-dawn darkness (Sunrise at ${solar.sunriseTime})`;
    }
  } else {
    // Forecast unavailable: do not assume rain, use LDR failover
    if (isNightByLdr) {
      isNight = true;
      nightReason = "FORECAST UNAVAILABLE (LDR darkness failover active)";
    }
  }

  if (isNight) {
    return {
      target: 'CLOSED',
      actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
      reason: `Combined Mode Priority #3: Nighttime active (${nightReason}) — CLOSE for dew protection`,
      isSafeDryingPermitted: false,
      systemMode: 'NORMAL',
      systemModeReason: "Night dew protection",
    };
  }

  // PRIORITY 4: SUNLIGHT / DRYING CONDITION
  // OPTIMAL DRYING:
  // IF local rain sensor = DRY AND LDR > 60% AND Rain Risk < 30 AND 10 km rain threat < 30
  // AND Daylight = TRUE AND no significant precipitation forecast in next 30–60 minutes
  // -> AUTONOMOUS OPEN, Status: "OPTIMAL DRYING"
  const ldrPct = sunPct ?? 0;
  const isLdrGood = ldrPct > cfg.LDR_OPEN_THRESHOLD; // > 60%
  const isRainRiskLow = rainRiskScore < cfg.RAIN_WATCH_THRESHOLD; // < 30
  const isPerimeterClear = forecastMetrics.perimeter10kmRainThreat < cfg.RAIN_WATCH_THRESHOLD; // < 30
  const noNearTermRain = !forecastMetrics.hasSignificantNearTermRain;

  if (isLdrGood && isRainRiskLow && isPerimeterClear && noNearTermRain) {
    return {
      target: 'OPEN',
      actionTaken: currentPhysicalPosition !== 'OPEN' && currentPhysicalPosition !== 'OPENING',
      reason: `Combined Mode Priority #4: OPTIMAL DRYING (LDR ${ldrPct}% > ${cfg.LDR_OPEN_THRESHOLD}%, Rain Risk ${rainRiskScore} < ${cfg.RAIN_WATCH_THRESHOLD}, 10km perimeter clear & dry plate) — AUTONOMOUS OPEN`,
      isSafeDryingPermitted: true,
      systemMode: 'NORMAL',
      systemModeReason: "OPTIMAL DRYING",
    };
  }

  // CLOUDY / LOW SUNLIGHT:
  // IF local rain sensor = DRY AND Rain Risk < 30
  // AND cloud_cover >= 80% AND shortwave_radiation < 150 W/m² AND LDR <= 50%
  // -> classify as: "CLOUDY / LOW SUNLIGHT" (do NOT classify it as rain). Target: CLOSED.
  const isCloudyOrLowSun = (ldrPct <= cfg.LDR_CLOSE_THRESHOLD) &&
    ((currentWeather?.cloud_cover ?? forecastMetrics.currentCloudCover) >= cfg.HEAVY_CLOUD_THRESHOLD && forecastMetrics.currentRadiation < cfg.LOW_SOLAR_RADIATION_WM2);

  if (isCloudyOrLowSun && isRainRiskLow) {
    return {
      target: 'CLOSED',
      actionTaken: currentPhysicalPosition !== 'CLOSED' && currentPhysicalPosition !== 'CLOSING',
      reason: `Combined Mode: CLOUDY / LOW SUNLIGHT (LDR ${ldrPct}%, cloud cover ${currentWeather?.cloud_cover ?? forecastMetrics.currentCloudCover}%, irradiance ${Math.round(forecastMetrics.currentRadiation)} W/m²) — insufficient solar drying`,
      isSafeDryingPermitted: false,
      systemMode: 'NORMAL',
      systemModeReason: "CLOUDY / LOW SUNLIGHT",
    };
  }

  // COMBINED MODE — RAIN WATCH & ML HARVEST GUARDIAN RECOVERY:
  // IF Rain Risk = 30–59 (or Random Forest predicts SOLAR_DRYING_OPEN) AND local rain sensor = DRY
  // Check if current environmental conditions are safe for solar drying:
  // Daylight = TRUE, current precip = 0, current rain = 0, 10km threat < 30, adequate sunlight/radiation, no immediate rain.
  const isCurrentlyOpen = currentPhysicalPosition === 'OPEN' || currentPhysicalPosition === 'OPENING';
  const hasAdequateSunOrRadiation = (ldrPct > cfg.LDR_CLOSE_THRESHOLD) || (forecastMetrics.currentRadiation >= cfg.LOW_SOLAR_RADIATION_WM2);
  const isSafeForCombinedDrying =
    !isLocalRainWet &&
    !isNight &&
    forecastMetrics.currentPrecip === 0 &&
    forecastMetrics.currentRain === 0 &&
    forecastMetrics.perimeter10kmRainThreat < cfg.RAIN_WATCH_THRESHOLD &&
    hasAdequateSunOrRadiation &&
    !forecastMetrics.hasSignificantNearTermRain;

  const isRfDryingConsensus = prediction.randomForest?.predictedOutcome === 'SOLAR_DRYING_OPEN' && (prediction.randomForest?.treeVotes.rain === 0);

  if (isSafeForCombinedDrying || (isRfDryingConsensus && !isLocalRainWet && !isNight)) {
    if (isCurrentlyOpen) {
      return {
        target: 'OPEN',
        actionTaken: false,
        reason: isRfDryingConsensus
          ? `Combined Mode: ML CONSENSUS (35-Tree RF 0 Rain, Drying Safe) — HOLDING OPEN`
          : `Combined Mode: RAIN WATCH (Rain Risk ${rainRiskScore}/100, dry plate & bright conditions) — HOLDING OPEN`,
        isSafeDryingPermitted: true,
        systemMode: 'NORMAL',
        systemModeReason: "Safe conditions holding open",
      };
    } else {
      // SAFE RECOVERY from previously CLOSED state
      return {
        target: 'OPEN',
        actionTaken: true,
        reason: isRfDryingConsensus
          ? `Combined Mode: ML CONSENSUS (35-Tree RF 0 Rain, Drying Safe) — SAFE RECOVERY — OPENING`
          : `Combined Mode: RAIN WATCH — SAFE RECOVERY — OPENING`,
        isSafeDryingPermitted: true,
        systemMode: 'NORMAL',
        systemModeReason: "Safe recovery opening",
      };
    }
  } else {
    // Current conditions are unsafe or nighttime
    return {
      target: 'CLOSED',
      actionTaken: isCurrentlyOpen,
      reason: `Combined Mode: RAIN WATCH (Rain Risk ${rainRiskScore}/100) — conditions unsafe for recovery — HOLD CLOSED`,
      isSafeDryingPermitted: false,
      systemMode: 'NORMAL',
      systemModeReason: "Holding closed due to marginal conditions",
    };
  }
}

/**
 * 5. ML DATASET & EVENT RECORDER
 * Automatically captures real-world features and decisions into a persistent dataset
 */
export function logMlEvent(
  state: SingleSourceSystemState,
  groundOutcome?: string
) {
  try {
    const record = {
      timestamp: state.timestamp,
      isoDate: new Date(state.timestamp).toISOString(),
      temperature: state.latest_sensor?.temperature ?? null,
      humidity: state.latest_sensor?.humidity ?? null,
      lightAdc: state.latest_sensor?.light ?? null,
      rainAnalog: state.latest_sensor?.rain_analog ?? null,
      actualRain: state.prediction.actual_rain,
      currentRainProb: state.weather_status.currentPrecipitation > 0 ? 80 : 15,
      currentPrecipitation: state.weather_status.currentPrecipitation,
      currentCloudCover: state.weather_status.currentCloudCover,
      nearbyWeightedRainProb: state.nearby_weather.distanceWeightedNearbyRisk,
      nearbySpatialConsistency: state.nearby_weather.spatialConsistency,
      humidityTrend5m: state.prediction.derived_features.humidityTrend5m,
      tempTrend5m: state.prediction.derived_features.tempTrend5m,
      lightTrend5m: state.prediction.derived_features.lightTrend5m,
      rainRiskPrediction: state.prediction.rain_risk,
      rainProbability: state.prediction.rain_probability,
      decisionAction: state.tarpaulin.lastDecision,
      decisionReason: state.tarpaulin.lastDecisionReason,
      systemMode: state.system_mode,
      groundTruthOutcome: groundOutcome || (state.prediction.actual_rain ? "RAIN" : "DRY"),
    };

    let dataset: any[] = [];
    if (fs.existsSync(DATASET_FILE)) {
      try {
        const raw = fs.readFileSync(DATASET_FILE, "utf-8");
        dataset = JSON.parse(raw);
      } catch {
        dataset = [];
      }
    }

    dataset.push(record);
    // Keep last 1000 events
    if (dataset.length > 1000) {
      dataset = dataset.slice(-1000);
    }

    fs.writeFileSync(DATASET_FILE, JSON.stringify(dataset, null, 2));
  } catch (err) {
    // Non-blocking logger
    console.warn("[PredictionEngine] ML event logging failed:", err);
  }
}
