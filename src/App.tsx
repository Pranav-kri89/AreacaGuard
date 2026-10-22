import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Sparkles,
  Code,
  Cable,
  Globe,
  Bot,
  Activity,
  SlidersHorizontal,
  Sliders,
  Radio,
  Shield,
  Layers,
  Clock,
  History,
  CheckCircle2,
  AlertTriangle,
  Copy,
  Check,
  MapPin,
  Edit3,
  Radar,
  Smartphone,
  Send,
  Compass,
  Menu,
  X,
  Sun,
  Flame,
  Wrench,
  Thermometer,
  CloudRain,
  CloudSun,
  ChevronDown,
  Sunrise,
  Sunset,
  Moon,
  Lock,
  Download,
  ExternalLink,
} from 'lucide-react';
import { ArecaDryerLogo } from './components/ArecaDryerLogo';
import {
  LocationItem,
  SensorTelemetry,
  WeatherForecastResponse,
  AIPredictionResult,
  CanopyMode,
  DecisionMode,
  DecisionLogEntry,
  AppLanguage,
  MotorSettings,
  FarmSettings,
  HeaterDryerState,
  MotorPingStatus,
  Telemetry5sRecord,
  Radar30kmScanResult,
  TelegramBotStatus,
  RoofPersistentState,
  SingleSourceSystemState,
} from './types';

import { POPULAR_LOCATIONS } from './utils/locations';
import { LocationWeatherPanel } from './components/LocationWeatherPanel';
import { SensorTelemetryPanel } from './components/SensorTelemetryPanel';
import { AIPredictionView } from './components/AIPredictionView';
import { AIChatDrawer } from './components/AIChatDrawer';
import { TopControlModeBar } from './components/TopControlModeBar';
import { SettingsModal, TabType } from './components/SettingsModal';
import { AiLiveGuardianBox } from './components/AiLiveGuardianBox';
import { FarmComparisonBoard } from './components/FarmComparisonBoard';
import { AiCenterScenarioOrb } from './components/AiCenterScenarioOrb';
import { CanopyFieldSlider } from './components/CanopyFieldSlider';
import { SheetPrecisionTestModal } from './components/SheetPrecisionTestModal';
import { AiSuggestionStrip } from './components/AiSuggestionStrip';
import { HourlyForecastSlider } from './components/HourlyForecastSlider';
import { LocationPickerModal } from './components/LocationPickerModal';
import { SourceDetailsModal } from './components/SourceDetailsModal';
import { Radar30kmModal } from './components/Radar30kmModal';
import { RadarMapTab } from './components/RadarMapTab';
import { DiagnosticAuditLog } from './components/DiagnosticAuditLog';
import { InstallAppModal } from './components/InstallAppModal';
import { generateArecaDryerEsp32Code } from './utils/espArecaCode';
import { translations } from './utils/translations';
import { WebSerialConnection } from './utils/webSerial';
import { getGoogleRainAnalysis } from './utils/weatherUtils';
import { getEffectiveAutomationConfig } from './config/automationConfig';

type ActiveTab = 'HOME' | 'RADAR_MAP' | 'COMPARISON' | 'ANALYTICS';

export default function App() {
  // 1. Language state: English ('en') or Kannada ('kn')
  const [language, setLanguage] = useState<AppLanguage>('en');
  const t = translations[language] || translations.en;

  // 2. Active Tab
  const [activeTab, setActiveTab] = useState<ActiveTab>('HOME');

  // 3. Location state
  const [selectedLocation, setSelectedLocation] = useState<LocationItem>(() => POPULAR_LOCATIONS[0]);

  // 4. Telemetry and Weather state
  const [telemetry, setTelemetry] = useState<SensorTelemetry | null>(null);
  const [isSensorOnline, setIsSensorOnline] = useState<boolean>(false);
  const [packetCount, setPacketCount] = useState<number>(0);
  const [lastSeenSeconds, setLastSeenSeconds] = useState<number | null>(null);

  // USB Web Serial state
  const [serialManager, setSerialManager] = useState<WebSerialConnection | null>(null);
  const [isSerialConnected, setIsSerialConnected] = useState<boolean>(false);
  const [serialError, setSerialError] = useState<string | null>(null);

  const [weather, setWeather] = useState<WeatherForecastResponse | null>(null);
  const [isWeatherLoading, setIsWeatherLoading] = useState<boolean>(false);

  // 5. Actuator & Decision Modes: Locks firmly into AUTO once activated
  const [canopyMode, setCanopyMode] = useState<CanopyMode>(() => {
    try {
      const saved = localStorage.getItem('areca_canopy_mode');
      if (saved === 'AUTO' || saved === 'OPEN' || saved === 'CLOSED' || saved === 'STOPPED') {
        return saved as CanopyMode;
      }
    } catch {}
    return 'AUTO';
  });
  const [decisionMode, setDecisionMode] = useState<DecisionMode>('COMBO'); // COMBO | SENSOR_ONLY | INTERNET_ONLY
  const [lastActuatorAction, setLastActuatorAction] = useState<string>('Waiting for sensor...');
  const [prediction, setPrediction] = useState<AIPredictionResult | null>(null);
  const [isAiLoading, setIsAiLoading] = useState<boolean>(false);
  const [lastAnalyzedTimestamp, setLastAnalyzedTimestamp] = useState<number | null>(null);

  // 6. Navigation Sidebar Drawer State (Android / Mobile & Desktop)
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState<boolean>(false);

  // 7. Farm & Motor Control Settings & Ping Status
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<TabType>('HEATER');
  const [isCopiedCode, setIsCopiedCode] = useState<boolean>(false);

  const openSettingsWithTab = (tab: TabType = 'HEATER') => {
    setSettingsInitialTab(tab);
    setIsSettingsOpen(true);
    setIsSidebarOpen(false);
  };

  const handleQuickCopyCode = async () => {
    try {
      const code = generateArecaDryerEsp32Code({
        serverUrl: `${window.location.origin}/sensor-data`,
      });
      await navigator.clipboard.writeText(code);
      setIsCopiedCode(true);
      setTimeout(() => setIsCopiedCode(false), 2500);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const [farmSettings, setFarmSettings] = useState<FarmSettings>(() => {
    try {
      const savedV2 = localStorage.getItem('areca_farm_settings_v2');
      if (savedV2) return JSON.parse(savedV2);
      const savedV1 = localStorage.getItem('areca_motor_settings_v1');
      if (savedV1) {
        return {
          heaterAutoEnabled: true,
          heaterMinTempThreshold: 26.0,
          heaterMaxTempTarget: 38.0,
          heaterAutoCloseSheet: true,
          heaterMaxContinuousMinutes: 15,
          heaterCooldownMinutes: 2,
          heaterPwmPower: 100,
          heaterPinIn3: 33,
          heaterPinIn4: 32,
          heaterPinEnb: 12,
          rainAnalogThreshold: 2800,
          rainDigitalInvert: false,
          rainDebounceChecks: 3,
          dryDebounceChecks: 4,
          sunlightDayLuxAdc: 2600,
          nightDetectionThreshold: 3400,
          sunlightMinAdc: 150,
          sunlightMaxAdc: 4095,
          onlineRainProbabilityThreshold: 30,
          onlinePrecipRateThreshold: 0.5,
          onlineCloudCoverThreshold: 85,
          onlineSyncIntervalMinutes: 5,
          controlMode: 'DURATION',
          frontRotations: 10,
          backRotations: 10,
          secondsPerRotation: 1.2,
          ...JSON.parse(savedV1),
        };
      }
    } catch {}
    return {
      heaterAutoEnabled: true,
      heaterMinTempThreshold: 26.0,
      heaterMaxTempTarget: 38.0,
      heaterAutoCloseSheet: true,
      heaterMaxContinuousMinutes: 15,
      heaterCooldownMinutes: 2,
      heaterPwmPower: 100,
      heaterPinIn3: 33,
      heaterPinIn4: 32,
      heaterPinEnb: 12,
      rainAnalogThreshold: 2800,
      rainDigitalInvert: false,
      rainDebounceChecks: 3,
      dryDebounceChecks: 4,
      sunlightDayLuxAdc: 2600,
      nightDetectionThreshold: 3400,
      sunlightMinAdc: 150,
      sunlightMaxAdc: 4095,
      onlineRainProbabilityThreshold: 30,
      onlinePrecipRateThreshold: 0.5,
      onlineCloudCoverThreshold: 85,
      onlineSyncIntervalMinutes: 5,
      controlMode: 'DURATION',
      frontRotations: 10,
      backRotations: 10,
      secondsPerRotation: 1.2,
      roofOpenSeconds: 5.56,
      roofCloseSeconds: 4.88,
      motorSpeedPercent: 100,
      reverseDirection: false,
      motor2Enabled: true,
      motor2RotationSeconds: 8,
      motor2Rotations: 6,
      motor2Mode: 'SYNCHRONIZED',
      autoStopSafetyLimit: 30,
    };
  });

  // Alias for backward compatibility
  const motorSettings = farmSettings;
  const setMotorSettings = setFarmSettings;

  const [motorPing, setMotorPing] = useState<MotorPingStatus | null>({
    isOnline: true,
    latencyMs: 18,
    openChannelStatus: 'READY',
    closeChannelStatus: 'READY',
    motor2ChannelStatus: 'READY',
    activeRotation: 'IDLE',
    activeRemainingSeconds: 0,
    lastPingTimestamp: Date.now(),
    pingCount: 1,
    driverType: '12V_L298N_HBRIDGE',
    pins: {
      in1Pin: 26,
      in2Pin: 25,
      in3Pin: 33,
      in4Pin: 32,
      openRelayPin: 26,
      closeRelayPin: 25,
      motor2Pin: 33,
      pwmSpeedPin: 14,
    },
  });

  // 12V Auxiliary Heater & Dryer State (Motor Driver Channel B)
  const [heaterState, setHeaterState] = useState<HeaterDryerState | null>({
    status: 'OFF',
    mode: 'AUTO',
    activeSeconds: 0,
    lastTriggerReason: 'Awaiting sensor temperature',
    dutyCycleCount: 0,
    targetMinTemp: 26,
    targetMaxTemp: 38,
    sheetAutoClosed: false,
    isOverheatSafety: false,
    heaterPwmPower: 100,
  });

  // 7. Continuous 5-Second Telemetry History Buffer
  const [telemetryHistory5s, setTelemetryHistory5s] = useState<Telemetry5sRecord[]>(() => {
    try {
      const saved = localStorage.getItem('areca_5s_history_v1');
      if (saved) return JSON.parse(saved);
    } catch {}
    return [];
  });

  // 8. Modals & AI Chat Drawer
  const [isLocationModalOpen, setIsLocationModalOpen] = useState<boolean>(false);
  const [isRadarModalOpen, setIsRadarModalOpen] = useState<boolean>(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState<boolean>(false);
  const [isModeModalOpen, setIsModeModalOpen] = useState<boolean>(false);
  const [roofPersistentState, setRoofPersistentState] = useState<RoofPersistentState | null>(null);
  const [systemState, setSystemState] = useState<SingleSourceSystemState | null>(null);
  const [radarSummary, setRadarSummary] = useState<Radar30kmScanResult | null>(null);

  const [telegramStatus, setTelegramStatus] = useState<TelegramBotStatus | null>(null);
  const [sourceModalType, setSourceModalType] = useState<'SENSOR' | 'INTERNET' | null>(null);
  const [isChatOpen, setIsChatOpen] = useState<boolean>(false);
  const [initialChatPrompt, setInitialChatPrompt] = useState<string | null>(null);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  // 9. Periodic Radar & Telegram Poller
  const fetchRadarAndTelegram = useCallback(async () => {
    try {
      const [radarRes, tgRes] = await Promise.allSettled([
        fetch(`/api/radar-30km?lat=${selectedLocation.latitude}&lon=${selectedLocation.longitude}`, {
          signal: AbortSignal.timeout(7000),
        }),
        fetch('/api/telegram-status', {
          signal: AbortSignal.timeout(5000),
        }),
      ]);

      if (radarRes.status === 'fulfilled' && radarRes.value.ok) {
        try {
          const rData = await radarRes.value.json();
          if (rData?.radar) setRadarSummary(rData.radar);
        } catch {}
      }

      if (tgRes.status === 'fulfilled' && tgRes.value.ok) {
        try {
          const tData = await tgRes.value.json();
          if (tData?.status) setTelegramStatus(tData.status);
        } catch {}
      }
    } catch (err) {
      console.warn('Radar/Telegram status polling note:', err);
    }
  }, [selectedLocation.latitude, selectedLocation.longitude]);

  useEffect(() => {
    fetchRadarAndTelegram();
    const timer = setInterval(fetchRadarAndTelegram, 15000);
    return () => clearInterval(timer);
  }, [fetchRadarAndTelegram]);

  // 10. Decision logs and Anti-Chatter Stabilization
  const [decisionLogs, setDecisionLogs] = useState<DecisionLogEntry[]>([]);
  const lastRainEventTimeRef = useRef<number>(0);
  const lastLoggedActionRef = useRef<{ action: 'CLOSED' | 'OPEN'; reason: string; timestamp: number } | null>(null);
  const MIN_RAIN_HOLD_MS = 60000; // 60s minimum hold closed after rain/alert to prevent motor hunting

  // Fixed LDR logic:
  // On standard ESP32 pull-up LDR divider, LOW ADC (0-1800) = Bright Sun, HIGH ADC (> 2600-3400) = Night / Dark
  const hasLightSensor = Boolean(telemetry && telemetry.light !== null && telemetry.light !== undefined);
  const rawLight = hasLightSensor ? telemetry!.light! : null;
  const isSensorNight = hasLightSensor ? (rawLight! > (farmSettings.nightDetectionThreshold || 3000)) : false;
  const isInternetNight = weather?.current ? weather.current.is_day === 0 : false;
  const isNightCalculated = decisionMode === 'SENSOR_ONLY'
    ? isSensorNight
    : decisionMode === 'INTERNET_ONLY'
    ? isInternetNight
    : (hasLightSensor && rawLight! < 2000 ? false : (hasLightSensor ? isSensorNight : isInternetNight));

  // Actual physical sunlight percentage calculated from hardware ADC:
  const sunlightPercent = rawLight !== null ? Math.max(0, Math.min(100, Math.round(((4095 - rawLight) / 4095) * 100))) : null;
  const isRainWet = Boolean(
    telemetry && (
      telemetry.rain || 
      telemetry.rain_verified || 
      telemetry.rain_digital === 0 || 
      (telemetry.rain_analog !== null && telemetry.rain_analog !== undefined && telemetry.rain_analog < (farmSettings.rainAnalogThreshold || 2800))
    )
  );

  // Solar Ephemeris & Sunset/Sunrise time calculations
  const formatSolarTime = (isoString?: string | null, fallback?: string | null) => {
    if (fallback) return fallback;
    if (!isoString) return null;
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return isoString;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return isoString || null;
    }
  };

  // Helper to find today's specific index in weather.daily array (accounts for past_days=1)
  const getTodaySolarIndex = (w: WeatherForecastResponse | null) => {
    if (!w?.daily?.time || !Array.isArray(w.daily.time)) return 0;
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const localToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const idx = w.daily.time.findIndex((t) => t.startsWith(localToday));
    return idx !== -1 ? idx : (w.daily.time.length > 1 ? 1 : 0);
  };

  const todaySolarIdx = getTodaySolarIndex(weather);

  const solarSunriseTime =
    systemState?.weather_status?.sunrise ||
    systemState?.prediction?.derived_features?.sunriseTime ||
    formatSolarTime(weather?.daily?.sunrise?.[todaySolarIdx]) ||
    '06:15 AM';

  const solarSunsetTime =
    systemState?.weather_status?.sunset ||
    systemState?.prediction?.derived_features?.sunsetTime ||
    formatSolarTime(weather?.daily?.sunset?.[todaySolarIdx]) ||
    '06:38 PM';

  const isSolarSunsetted = Boolean(
    systemState?.weather_status?.isSunsetted ??
    systemState?.prediction?.derived_features?.isAfterSunset ??
    (weather?.daily?.sunset?.[todaySolarIdx] ? Date.now() >= new Date(weather.daily.sunset[todaySolarIdx]).getTime() : false)
  );

  const isSolarPreSunrise = Boolean(
    systemState?.prediction?.derived_features?.isBeforeSunrise ??
    (weather?.daily?.sunrise?.[todaySolarIdx] ? Date.now() < new Date(weather.daily.sunrise[todaySolarIdx]).getTime() : false)
  );

  const isSolarDaylight = Boolean(
    systemState?.weather_status?.isDaylight ??
    systemState?.prediction?.derived_features?.isSolarDaylight ??
    (!isSolarSunsetted && !isSolarPreSunrise)
  );

  // Re-evaluate Decision Logic with Continuous Multi-Sample Verification and Anti-Chatter Hysteresis
  const evaluateActuatorDecision = useCallback(
    (
      mode: CanopyMode,
      decMode: DecisionMode,
      sensor: SensorTelemetry | null,
      wData: WeatherForecastResponse | null,
      isNight: boolean,
      isOnline: boolean,
      radar: Radar30kmScanResult | null
    ) => {
      if (mode === 'OPEN') {
        return 'OPEN (Forced Open)';
      }
      if (mode === 'CLOSED') {
        return 'CLOSED (Forced Closed)';
      }

      const cfg = getEffectiveAutomationConfig(farmSettings);

      // Hardware Rain Sensor State:
      const isRainConnected = Boolean(sensor && sensor.rain_connected);
      const sensorRainMomentary = isRainConnected && Boolean(
        sensor && (
          sensor.rain || 
          sensor.rain_digital === 0 || 
          (sensor.rain_analog !== null && sensor.rain_analog !== undefined && sensor.rain_analog < (farmSettings.rainAnalogThreshold || 2800))
        )
      );
      
      const isVerifiedRain = isRainConnected && Boolean(
        sensor?.rain_verified || sensor?.verification_state === 'CONFIRMED_RAIN'
      );
      const isLocalPlateWet = isVerifiedRain || sensorRainMomentary;

      // LDR Sunlight Intensity Calculation (0-100%):
      // On standard ESP32 ADC: 0 ADC = maximum 100% direct sunlight, 4095 ADC = pitch dark
      const rawLdr = sensor?.light !== null && sensor?.light !== undefined ? sensor.light : null;
      const ldrSunlightPercent = rawLdr !== null ? Math.max(0, Math.min(100, Math.round(((4095 - rawLdr) / 4095) * 100))) : null;

      // Forecast metrics & Open-Meteo analysis
      const googleAnalysis = getGoogleRainAnalysis(wData);
      const currentPrecip = wData?.current?.precipitation ?? googleAnalysis.currentPrecipMm ?? 0;
      const currentRainRate = wData?.current?.rain ?? 0;
      const currentCloudCover = wData?.current?.cloud_cover ?? googleAnalysis.cloudCover ?? 0;
      const rainRiskScore = googleAnalysis.calibratedRisk ?? 0;

      // Spatial Nearest-Location Rain Analysis (Perimeter check)
      const nearestDist = radar?.nearestRainDistanceKm;
      const is10kmClear = radar?.is10kmPerimeterClear ?? true;
      const nearestPlace = radar?.nearestRainPlaceName || 'Regional perimeter';
      const perimeter10kmRainThreat = !is10kmClear || (nearestDist !== null && nearestDist !== undefined && nearestDist <= 10.0) ? 65 : (radar?.aggregateRainProbability ?? 10);

      // Hourly projection & solar irradiance matching current farm hour
      const getCurrentHourIdx = (w: WeatherForecastResponse | null) => {
        if (!w?.hourly?.time || !Array.isArray(w.hourly.time)) return 0;
        const offsetSeconds = typeof w?.utc_offset_seconds === 'number' ? w.utc_offset_seconds : 19800;
        const farmLocalDate = new Date(Date.now() + (offsetSeconds * 1000));
        const pad = (n: number) => String(n).padStart(2, '0');
        const localHourIso = `${farmLocalDate.getUTCFullYear()}-${pad(farmLocalDate.getUTCMonth() + 1)}-${pad(farmLocalDate.getUTCDate())}T${pad(farmLocalDate.getUTCHours())}:00`;
        const idx = w.hourly.time.findIndex((t) => t.startsWith(localHourIso));
        if (idx !== -1) return idx;
        const curHour = farmLocalDate.getUTCHours();
        return Math.min(curHour + (w.hourly.time.length > 24 ? 24 : 0), w.hourly.time.length - 1);
      };

      const hourIdx = getCurrentHourIdx(wData);
      const curRadiation = wData?.hourly?.shortwave_radiation?.[hourIdx] ?? (isNight ? 0 : 500);
      const nextHourPrecip = wData?.hourly?.precipitation?.[hourIdx + 1] ?? 0;
      const nextHourPop = wData?.hourly?.precipitation_probability?.[hourIdx + 1] ?? 0;
      const nextHourRain = wData?.hourly?.rain?.[hourIdx + 1] ?? 0;

      const isImmediateSignificantRain =
        nextHourPrecip >= (cfg.SIGNIFICANT_PRECIPITATION_MM ?? 1.0) ||
        (nextHourPop >= 70 && (nextHourPrecip > 0 || nextHourRain > 0));

      // Post-rain hysteresis check
      const now = Date.now();
      if (isLocalPlateWet) {
        lastRainEventTimeRef.current = now;
      }

      const holdElapsed = now - lastRainEventTimeRef.current;
      const requiredHoldMs = (cfg.RAIN_REOPEN_DELAY_MINUTES || 10) * 60 * 1000;
      const isHoldingClosed = lastRainEventTimeRef.current > 0 && holdElapsed < requiredHoldMs;
      const remainingHoldSec = Math.max(1, Math.ceil((requiredHoldMs - holdElapsed) / 1000));

      let action = 'OPEN (Optimal Drying)';
      let reason = 'Optimal solar drying conditions active';
      let executedAction: 'CLOSED' | 'OPEN' = 'OPEN';

      // ==========================================
      // MODE 1: SENSORS MODE (Hardware Only)
      // DO NOT use: Open-Meteo, Internet forecast, Rain probability, Cloud cover, Weather API, Sunrise/sunset
      // Use ONLY: ESP32 online status, Rain sensor plate, LDR
      // LDR_OPEN_THRESHOLD = 60%, LDR_CLOSE_THRESHOLD = 50%
      // ==========================================
      if (decMode === 'SENSOR_ONLY') {
        const isHardwareOffline = !isOnline;
        const currentPosIsClosed = roofPersistentState?.physicalRoofPosition === 'CLOSED';

        if (isHardwareOffline) {
          action = 'SAFE CLOSED (Hardware Offline)';
          reason = 'Sensors Mode: ESP32 hardware offline — SAFE CLOSED';
          executedAction = 'CLOSED';
        } else if (isLocalPlateWet) {
          action = 'IMMEDIATE CLOSE (Rain Plate Wet)';
          reason = 'Sensors Mode: Rain sensor plate WET — IMMEDIATE CLOSE';
          executedAction = 'CLOSED';
        } else if (currentPosIsClosed) {
          // IF tarpaulin is currently CLOSED: IF LDR > 60% AND rain sensor = DRY -> OPEN; ELSE -> KEEP CLOSED
          if ((ldrSunlightPercent ?? 0) > cfg.LDR_OPEN_THRESHOLD && !isLocalPlateWet) {
            action = 'AUTONOMOUS OPEN (LDR > 60% & Dry)';
            reason = `Sensors Mode: LDR sunlight ${ldrSunlightPercent}% > ${cfg.LDR_OPEN_THRESHOLD}% & rain plate DRY — OPEN`;
            executedAction = 'OPEN';
          } else {
            action = 'KEEP CLOSED (LDR ≤ 60%)';
            reason = `Sensors Mode: LDR sunlight ${ldrSunlightPercent ?? 0}% ≤ ${cfg.LDR_OPEN_THRESHOLD}% — KEEP CLOSED`;
            executedAction = 'CLOSED';
          }
        } else {
          // IF tarpaulin is currently OPEN: IF LDR < 50% -> CLOSE; ELSE -> KEEP OPEN
          if ((ldrSunlightPercent ?? 0) < cfg.LDR_CLOSE_THRESHOLD) {
            action = 'CLOSE (LDR < 50%)';
            reason = `Sensors Mode: LDR sunlight ${ldrSunlightPercent}% < ${cfg.LDR_CLOSE_THRESHOLD}% — CLOSE`;
            executedAction = 'CLOSED';
          } else {
            action = 'KEEP OPEN (LDR ≥ 50% & Dry)';
            reason = `Sensors Mode: LDR sunlight ${ldrSunlightPercent}% ≥ ${cfg.LDR_CLOSE_THRESHOLD}% & rain plate DRY — KEEP OPEN`;
            executedAction = 'OPEN';
          }
        }
      } 
      // ==========================================
      // MODE 2: FORECAST MODE (Internet / Forecast Only)
      // Priority Order:
      // 1. NIGHT -> CLOSE
      // 2. CURRENT PRECIPITATION / RAIN -> CLOSE
      // 3. IMMEDIATE SIGNIFICANT RAIN -> CLOSE
      // 4. HIGH RAIN THREAT (Risk >= 60) -> CLOSE
      // LOW SOLAR RADIATION (Cloud >= 80% & Rad < 150 & Risk < 30) -> CLOSE
      // 5. SAFE CURRENT CONDITIONS (Risk < 30 & current safe) -> OPEN
      // 6. RAIN WATCH (Risk 30-59): Safe -> CASE A: HOLD OPEN, CASE B: RECOVER TO OPEN; Unsafe -> HOLD CLOSED
      // ==========================================
      else if (decMode === 'INTERNET_ONLY') {
        if (!wData) {
          action = 'FORECAST UNAVAILABLE';
          reason = 'Forecast Mode: FORECAST UNAVAILABLE';
          executedAction = 'CLOSED';
        } else if (isSolarSunsetted || isSolarPreSunrise || isNight) {
          const timeReason = isSolarSunsetted ? `Sunset passed (${solarSunsetTime})` : `Pre-dawn darkness (Sunrise at ${solarSunriseTime})`;
          action = 'AUTONOMOUS CLOSE (Nighttime)';
          reason = `Forecast Mode: Nighttime active (${timeReason}) — AUTONOMOUS CLOSE`;
          executedAction = 'CLOSED';
        } else if (currentPrecip > 0 || currentRainRate > 0) {
          action = 'AUTONOMOUS CLOSE (Current Rain)';
          reason = `Forecast Mode: Active rain falling (${currentRainRate || currentPrecip} mm) — AUTONOMOUS CLOSE`;
          executedAction = 'CLOSED';
        } else if (isImmediateSignificantRain) {
          action = 'AUTONOMOUS CLOSE (Immediate Rain)';
          reason = `Forecast Mode: Significant precipitation forecast approaching in next 10–20 minutes — AUTONOMOUS CLOSE`;
          executedAction = 'CLOSED';
        } else if (rainRiskScore >= cfg.RAIN_CLOSE_THRESHOLD || perimeter10kmRainThreat >= cfg.RAIN_CLOSE_THRESHOLD) {
          const rainReason = rainRiskScore >= cfg.RAIN_CLOSE_THRESHOLD
            ? `Rain Risk score ${rainRiskScore}/100 >= ${cfg.RAIN_CLOSE_THRESHOLD}`
            : `10 km perimeter rain threat ${perimeter10kmRainThreat} >= ${cfg.RAIN_CLOSE_THRESHOLD}`;

          action = 'AUTONOMOUS CLOSE (Rain Threat)';
          reason = `Forecast Mode: ${rainReason} — AUTONOMOUS CLOSE`;
          executedAction = 'CLOSED';
        } else if (currentCloudCover >= cfg.HEAVY_CLOUD_THRESHOLD && curRadiation < cfg.LOW_SOLAR_RADIATION_WM2 && rainRiskScore < cfg.RAIN_WATCH_THRESHOLD) {
          action = 'LOW SOLAR RADIATION';
          reason = `Forecast Mode: LOW SOLAR RADIATION (Cloud cover ${currentCloudCover}% >= ${cfg.HEAVY_CLOUD_THRESHOLD}%, solar irradiance ${Math.round(curRadiation)} W/m² < ${cfg.LOW_SOLAR_RADIATION_WM2} W/m²) — insufficient solar drying`;
          executedAction = 'CLOSED';
        } else if (
          isSolarDaylight &&
          rainRiskScore < cfg.RAIN_WATCH_THRESHOLD &&
          currentPrecip === 0 &&
          currentRainRate === 0 &&
          perimeter10kmRainThreat < cfg.RAIN_WATCH_THRESHOLD &&
          curRadiation >= cfg.LOW_SOLAR_RADIATION_WM2 &&
          !isImmediateSignificantRain
        ) {
          action = 'AUTONOMOUS OPEN (Clear)';
          reason = `Forecast Mode: Daylight active (${solarSunriseTime} to ${solarSunsetTime}), Rain Risk ${rainRiskScore} (< ${cfg.RAIN_WATCH_THRESHOLD}), precip 0mm & 10km perimeter clear — AUTONOMOUS OPEN`;
          executedAction = 'OPEN';
        } else {
          // RAIN WATCH (30-59): Check if current environmental conditions are safe for drying
          const isCurrentlySafeForDrying =
            isSolarDaylight &&
            currentRainRate === 0 &&
            currentPrecip === 0 &&
            perimeter10kmRainThreat < cfg.RAIN_WATCH_THRESHOLD &&
            curRadiation >= cfg.LOW_SOLAR_RADIATION_WM2 &&
            !isImmediateSignificantRain;

          const currentPosIsClosed = roofPersistentState?.physicalRoofPosition === 'CLOSED';
          if (isCurrentlySafeForDrying) {
            if (currentPosIsClosed) {
              action = 'RAIN WATCH (Safe Recovery)';
              reason = 'RAIN WATCH — SAFE RECOVERY — OPENING';
              executedAction = 'OPEN';
            } else {
              action = 'RAIN WATCH (Hold OPEN)';
              reason = 'RAIN WATCH — HOLDING OPEN';
              executedAction = 'OPEN';
            }
          } else {
            action = 'RAIN WATCH (Hold CLOSED)';
            reason = `Forecast Mode: RAIN WATCH (Rain Risk ${rainRiskScore}/100) — conditions unsafe for recovery — HOLD CLOSED`;
            executedAction = 'CLOSED';
          }
        }
      } 
      // ==========================================
      // MODE 3: COMBINED MODE (Primary Intelligent Mode)
      // Priority 1: Local Rain Sensor
      // Priority 2: Forecast Rain Threat
      // Priority 3: Day/Night
      // Priority 4: Sunlight / Drying Condition
      // ==========================================
      else {
        if (!isOnline && isLocalPlateWet === undefined) {
          action = 'SAFE CLOSED (Sensor Fault)';
          reason = 'Combined Mode: Critical sensor state cannot be determined — SAFE CLOSED';
          executedAction = 'CLOSED';
        } else if (isLocalPlateWet) {
          action = 'IMMEDIATE CLOSE (Local Rain Sensor WET)';
          reason = 'Combined Mode Priority #1: Local rain sensor WET — IMMEDIATE CLOSE';
          executedAction = 'CLOSED';
        } else if (isHoldingClosed) {
          action = `STABILIZING (${remainingHoldSec}s)`;
          reason = `Combined Mode: Post-rain drying stabilization — rain sensor must remain dry continuously for ${cfg.RAIN_REOPEN_DELAY_MINUTES} min (${remainingHoldSec}s remaining)`;
          executedAction = 'CLOSED';
        } else if (
          rainRiskScore >= cfg.RAIN_CLOSE_THRESHOLD ||
          (googleAnalysis.currentPrecipProb >= 70 && currentPrecip >= cfg.SIGNIFICANT_PRECIPITATION_MM) ||
          perimeter10kmRainThreat >= cfg.RAIN_CLOSE_THRESHOLD
        ) {
          let preReason = "";
          if (rainRiskScore >= cfg.RAIN_CLOSE_THRESHOLD) preReason = `Rain Risk score ${rainRiskScore}/100 >= ${cfg.RAIN_CLOSE_THRESHOLD}`;
          else if (googleAnalysis.currentPrecipProb >= 70 && currentPrecip >= cfg.SIGNIFICANT_PRECIPITATION_MM) preReason = `Forecast rain prob ${googleAnalysis.currentPrecipProb}% >= 70% with precip ${currentPrecip}mm`;
          else preReason = `10 km rain threat ${perimeter10kmRainThreat} >= ${cfg.RAIN_CLOSE_THRESHOLD}`;

          action = 'PREEMPTIVE CLOSE (Rain Threat)';
          reason = `Combined Mode Priority #2: ${preReason} — PREEMPTIVE CLOSE`;
          executedAction = 'CLOSED';
        } else if (isSolarSunsetted || isSolarPreSunrise || (wData ? false : (rawLdr !== null && rawLdr > 3400))) {
          const nightReason = isSolarSunsetted ? `Sunset has occurred (${solarSunsetTime})` : `Pre-dawn darkness (Sunrise at ${solarSunriseTime})`;
          action = 'CLOSE (Night Dew Protection)';
          reason = `Combined Mode Priority #3: Nighttime active (${nightReason}) — CLOSE for dew protection`;
          executedAction = 'CLOSED';
        } else if (
          !isLocalPlateWet &&
          (ldrSunlightPercent ?? 0) > cfg.LDR_OPEN_THRESHOLD &&
          rainRiskScore < cfg.RAIN_WATCH_THRESHOLD &&
          perimeter10kmRainThreat < cfg.RAIN_WATCH_THRESHOLD &&
          isSolarDaylight
        ) {
          action = 'AUTONOMOUS OPEN (Optimal Drying)';
          reason = `Combined Mode Priority #4: OPTIMAL DRYING (LDR ${ldrSunlightPercent}% > ${cfg.LDR_OPEN_THRESHOLD}%, Rain Risk ${rainRiskScore} < ${cfg.RAIN_WATCH_THRESHOLD}, 10km perimeter clear & dry plate) — AUTONOMOUS OPEN`;
          executedAction = 'OPEN';
        } else if (
          !isLocalPlateWet &&
          rainRiskScore < cfg.RAIN_WATCH_THRESHOLD &&
          ((ldrSunlightPercent !== null && ldrSunlightPercent <= cfg.LDR_CLOSE_THRESHOLD) || currentCloudCover >= cfg.HEAVY_CLOUD_THRESHOLD)
        ) {
          action = 'CLOUDY / LOW SUNLIGHT';
          reason = `Combined Mode: CLOUDY / LOW SUNLIGHT (LDR ${ldrSunlightPercent ?? 0}%, cloud cover ${currentCloudCover}%) — insufficient solar drying`;
          executedAction = 'CLOSED';
        } else {
          // RAIN WATCH (30-59) -> Hold current state
          const currentPosIsClosed = roofPersistentState?.physicalRoofPosition === 'CLOSED' || lastActuatorAction.includes('CLOSED');
          action = currentPosIsClosed ? 'RAIN WATCH (Hold CLOSED)' : 'RAIN WATCH (Hold OPEN)';
          reason = `Combined Mode: RAIN WATCH (Rain Risk ${rainRiskScore}/100, 30–59 band & dry plate) — maintaining state`;
          executedAction = currentPosIsClosed ? 'CLOSED' : 'OPEN';
        }
      }

      // Deduplicated Decision Event Logger:
      // Only logs on genuine state change or primary reason transition (debounced) to prevent 2.5s log flood
      const last = lastLoggedActionRef.current;
      const actionChanged = !last || last.action !== executedAction;
      const isHoldTransition = action.includes('Stabilizing');
      const reasonChanged = !last || (last.reason !== reason && !isHoldTransition && (now - last.timestamp > 15000));
      const heartbeatDue = !last || (now - last.timestamp > 120000);

      if (actionChanged || reasonChanged || heartbeatDue) {
        lastLoggedActionRef.current = { action: executedAction, reason, timestamp: now };
        setDecisionLogs((prev) => [
          {
            id: `${now}-${Math.random().toString(36).substring(2, 7)}`,
            timestamp: new Date().toISOString(),
            timeLabel: new Date().toLocaleTimeString(),
            executedAction,
            reason,
            decisionMode: decMode,
            sensorWet: isVerifiedRain || Boolean(sensorRainMomentary),
            sensorHumidity: sensor?.humidity || 0,
            googleRainRate: googleAnalysis.currentPrecipMm,
            googlePrecipProb: googleAnalysis.currentPrecipProb,
            googleHumidity: wData?.current?.relative_humidity_2m || 0,
            dayNight: isNight ? 'NIGHT' : 'DAY',
          },
          ...prev.slice(0, 49),
        ]);
      }

      return action;
    },
    [farmSettings.rainAnalogThreshold]
  );

  // Fetch Telemetry from Server
  const fetchTelemetry = useCallback(async () => {
    try {
      const res = await fetch('/api/sensor-data');
      if (res.ok) {
        const data = await res.json();
        setIsSensorOnline(Boolean(data.isOnline));
        setPacketCount(data.packetCount || 0);
        setLastSeenSeconds(data.lastSeenSeconds ?? null);
        setTelemetry(data.latest || null);
        if (data.canopyState) {
          setCanopyMode((prev) => {
            if (prev === 'AUTO' && data.canopyState !== 'AUTO' && data.canopyState !== 'STOPPED') {
              return 'AUTO';
            }
            return data.canopyState;
          });
        }
        if (data.roofState) setRoofPersistentState(data.roofState);
        if (data.heater) setHeaterState(data.heater);
        if (data.farmSettings) setMotorSettings(data.farmSettings);
        if (data.systemState) setSystemState(data.systemState);
      }

    } catch (err) {
      console.warn('Telemetry fetch error:', err);
    }
  }, []);

  // Fetch Roof Persistent State directly
  const fetchRoofState = useCallback(async () => {
    try {
      const res = await fetch('/api/roof-state');
      if (res.ok) {
        const data = await res.json();
        setRoofPersistentState(data);
        if (data.canopyState) {
          setCanopyMode((prev) => {
            if (prev === 'AUTO' && data.canopyState !== 'AUTO' && data.canopyState !== 'STOPPED') {
              return 'AUTO';
            }
            return data.canopyState;
          });
        }
      }
    } catch (err) {
      console.warn('Roof state fetch error:', err);
    }
  }, []);

  // Fetch Live Weather for Location
  const fetchWeather = useCallback(async (loc: LocationItem) => {
    setIsWeatherLoading(true);
    try {
      const res = await fetch(`/api/weather-forecast?lat=${loc.latitude}&lon=${loc.longitude}`);
      if (res.ok) {
        const data: WeatherForecastResponse = await res.json();
        setWeather(data);
        return data;
      }
    } catch (err) {
      console.warn('Weather fetch error:', err);
    } finally {
      setIsWeatherLoading(false);
    }
    return null;
  }, []);

  // Switch decision mode with immediate server-sync and re-evaluation
  const handleSetDecisionMode = async (newMode: DecisionMode) => {
    setDecisionMode(newMode);
    try {
      await fetch('/api/decision-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode }),
      });
      fetchPrediction();
    } catch (e) {
      console.warn('Failed to switch decision mode:', e);
    }
  };

  // Fetch AI Prediction
  const fetchPrediction = useCallback(async () => {
    setIsAiLoading(true);
    try {
      const res = await fetch('/api/predict-rain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locationName: selectedLocation.name,
          weatherData: weather,
          sensorData: telemetry,
          decisionMode: decisionMode,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.prediction) setPrediction(data.prediction);
        if (data.lastActuatorAction && canopyMode === 'AUTO') {
          setLastActuatorAction(data.lastActuatorAction);
        }
      }
    } catch (err) {
      console.warn('AI prediction fetch error:', err);
    } finally {
      setIsAiLoading(false);
    }
  }, [selectedLocation.name, weather, telemetry, canopyMode, decisionMode]);

  // Synchronize actuator state: In AUTO mode, the backend decision engine is the authoritative single source of truth
  useEffect(() => {
    if (canopyMode === 'AUTO' && roofPersistentState?.lastActuatorAction) {
      setLastActuatorAction(roofPersistentState.lastActuatorAction);
    } else {
      const action = evaluateActuatorDecision(
        canopyMode,
        decisionMode,
        telemetry,
        weather,
        isNightCalculated,
        isSensorOnline,
        radarSummary
      );
      setLastActuatorAction(action);
    }
  }, [
    canopyMode,
    decisionMode,
    telemetry,
    weather,
    isNightCalculated,
    isSensorOnline,
    radarSummary,
    evaluateActuatorDecision,
    roofPersistentState?.lastActuatorAction,
  ]);

  // Initial mount & periodic polling
  useEffect(() => {
    fetchTelemetry();
    fetchRoofState();
    fetchWeather(selectedLocation);

    const interval = setInterval(() => {
      fetchTelemetry();
      fetchRoofState();
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchTelemetry, fetchRoofState, fetchWeather, selectedLocation]);

  // Initial load: Fetch server-side 5s history, motor settings, and motor ping
  useEffect(() => {
    fetch('/api/telemetry-history')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.records && Array.isArray(data.records) && data.records.length > 0) {
          setTelemetryHistory5s((prev) => {
            if (prev.length === 0) return data.records;
            const existingTs = new Set(prev.map((p) => p.timestamp));
            const newOnes = data.records.filter((r: Telemetry5sRecord) => !existingTs.has(r.timestamp));
            return [...newOnes, ...prev].slice(-720);
          });
        }
      })
      .catch(() => {});

    fetch('/api/motor-settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.settings) setMotorSettings(data.settings);
      })
      .catch(() => {});

    fetch('/api/motor-ping', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setMotorPing(data);
      })
      .catch(() => {});
  }, []);

  // Continuous 5-Second Interval Telemetry Snapshot Recorder
  useEffect(() => {
    const recordSnapshot = () => {
      const now = Date.now();
      const record: Telemetry5sRecord = {
        id: `snap_${now}_${Math.random().toString(36).substring(2, 6)}`,
        timestamp: now,
        timeLabel: new Date(now).toLocaleTimeString(),
        temperature: telemetry?.dht_connected ? telemetry.temperature : null,
        humidity: telemetry?.dht_connected ? telemetry.humidity : null,
        dhtConnected: Boolean(telemetry?.dht_connected),
        rainAnalog: telemetry?.rain_connected ? telemetry.rain_analog : null,
        rainDigital: telemetry?.rain_connected ? telemetry.rain_digital : null,
        rainDetected: Boolean(telemetry?.rain_connected && (telemetry.rain || telemetry.rain_digital === 0)),
        rainConnected: Boolean(telemetry?.rain_connected),
        rainVerified: Boolean(
          telemetry?.rain_connected &&
            (telemetry.rain_verified || telemetry.verification_state === 'CONFIRMED_RAIN')
        ),
        verificationState: telemetry?.verification_state || 'CONFIRMED_DRY',
        light: telemetry?.light_connected ? telemetry.light : null,
        lightPercent:
          telemetry?.light_connected && telemetry.light !== null
            ? Math.max(0, Math.min(100, Math.round(((4095 - telemetry.light) / 4095) * 100)))
            : null,
        lightConnected: Boolean(telemetry?.light_connected),
        wifiRssi: telemetry?.wifi_rssi ?? null,
        canopyState: canopyMode,
        lastAction: lastActuatorAction,
        weatherPrecip: weather?.current?.precipitation ?? 0,
        weatherTemp: weather?.current?.temperature_2m ?? null,
        weatherHumidity: weather?.current?.relative_humidity_2m ?? null,
      };

      setTelemetryHistory5s((prev) => {
        const updated = [...prev.slice(-719), record];
        try {
          localStorage.setItem('areca_5s_history_v1', JSON.stringify(updated.slice(-360)));
        } catch {}
        return updated;
      });
    };

    const timer = setInterval(recordSnapshot, 5000);
    return () => clearInterval(timer);
  }, [telemetry, canopyMode, lastActuatorAction, weather]);

  // AI analysis triggered strictly ON DEMAND (per user requirement)
  const handleTriggerAiAnalysis = useCallback(async () => {
    setLastAnalyzedTimestamp(Date.now());
    await fetchPrediction();
  }, [fetchPrediction]);

  // Motor Ping & Timing Control Handlers
  const handlePingMotor = useCallback(async () => {
    try {
      const res = await fetch('/api/motor-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (res.ok) {
        const data = await res.json();
        setMotorPing(data);
      }
    } catch (err) {
      console.warn('Motor ping error:', err);
    }
  }, []);

  const handleSaveMotorSettings = useCallback(async (newSettings: FarmSettings) => {
    setMotorSettings(newSettings);
    try {
      localStorage.setItem('areca_farm_settings_v2', JSON.stringify(newSettings));
      await fetch('/api/farm-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: newSettings }),
      });
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  }, []);

  const handleControlHeater = useCallback(
    async (action: 'AUTO' | 'FORCE_ON' | 'FORCE_OFF' | 'TEST_PULSE', customDurationSec?: number) => {
      try {
        const res = await fetch('/api/heater-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, durationSeconds: customDurationSec }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.heater) setHeaterState(data.heater);
        }
      } catch (err) {
        console.error('Failed to control 12V heater:', err);
      }
    },
    []
  );

  const handleTriggerMotorTest = useCallback(
    async (command: 'OPEN' | 'CLOSE' | 'MOTOR2' | 'STOP', customSeconds?: number) => {
      try {
        const res = await fetch('/api/motor-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command,
            customSeconds,
            source: 'WEB_UI',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.motorPing) setMotorPing(data.motorPing);
          fetchRoofState();
        }
      } catch (err) {
        console.error('Failed to trigger motor:', err);
      }
    },
    [fetchRoofState]
  );

  // Global Emergency Stop for Homepage & Recovery
  const handleEmergencyStop = useCallback(async () => {
    try {
      const res = await fetch('/api/canopy-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'STOP', source: 'EMERGENCY_STOP' }),
      });
      if (res.ok) {
        const data = await res.json();
        setCanopyMode('STOPPED');
        setLastActuatorAction(data.lastActuatorAction || 'Motor Stopped (Safety Halt)');
        await fetchRoofState();
      }
    } catch (err) {
      console.error('Emergency stop error:', err);
    }
  }, [fetchRoofState]);

  // Global Resume / Start for Homepage & Recovery
  const handleResumeStart = useCallback(async () => {
    try {
      const res = await fetch('/api/canopy-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'START', source: 'WEB_UI' }),
      });
      if (res.ok) {
        const data = await res.json();
        setCanopyMode(data.canopyState || 'AUTO');
        setLastActuatorAction(data.lastActuatorAction || 'System Resumed (Auto-Pilot Active)');
        await fetchRoofState();
      }
    } catch (err) {
      console.error('Resume start error:', err);
    }
  }, [fetchRoofState]);

  // Momentary Test Inching / Long-press commands
  const handleMomentaryCommand = useCallback(
    async (command: 'MOMENTARY_OPEN' | 'MOMENTARY_CLOSE' | 'STOP') => {
      try {
        await fetch('/api/motor-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command, source: 'TEST_INCHING' }),
        });
        await fetchRoofState();
      } catch (err) {
        console.error('Momentary command error:', err);
      }
    },
    [fetchRoofState]
  );

  // Calibration sync: Synchronizes physical limit with software tracking
  const handleCalibratePosition = useCallback(
    async (position: 'OPEN' | 'CLOSED') => {
      try {
        const res = await fetch('/api/roof-state/calibrate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position }),
        });
        if (res.ok) {
          await fetchRoofState();
        }
      } catch (err) {
        console.error('Calibrate position error:', err);
      }
    },
    [fetchRoofState]
  );

  const handleClearHistory = useCallback(() => {
    setTelemetryHistory5s([]);
    try {
      localStorage.removeItem('areca_5s_history_v1');
    } catch {}
  }, []);

  // Handle Location Select
  const handleSelectLocation = async (newLoc: LocationItem) => {
    setSelectedLocation(newLoc);
    await fetchWeather(newLoc);
  };

  // Canopy Actuator Mode Switch: When AUTO is selected, it locks firmly in AUTO mode
  const handleSetCanopyMode = async (mode: CanopyMode) => {
    setCanopyMode(mode);
    try {
      localStorage.setItem('areca_canopy_mode', mode);
    } catch {}

    // Direct WebSerial dispatch if board is connected locally via USB
    if (serialManager && isSerialConnected) {
      if (mode === 'OPEN') serialManager.sendCommand('MOTOR_OPEN\n');
      else if (mode === 'CLOSED') serialManager.sendCommand('MOTOR_CLOSE\n');
      else if (mode === 'STOPPED') serialManager.sendCommand('MOTOR_STOP\n');
    }

    try {
      const res = await fetch('/api/canopy-control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: mode, source: 'WEB_UI' }),
      });
      if (res.ok) {
        const data = await res.json();
        setLastActuatorAction(data.lastActuatorAction);
        if (data.canopyState) {
          setCanopyMode((prev) => {
            if (prev === 'AUTO' && data.canopyState !== 'AUTO' && data.canopyState !== 'STOPPED') {
              return 'AUTO';
            }
            return data.canopyState;
          });
        }
        fetchRoofState();
        fetchPrediction();
      }
    } catch (err) {
      console.error('Failed to set canopy mode:', err);
    }
  };

  // Direct Motor Test handler for both directions (Always active on Home Page)
  const handleDirectMotorTest = useCallback(
    async (command: 'OPEN' | 'CLOSE' | 'STOP' | 'MOMENTARY_OPEN' | 'MOMENTARY_CLOSE') => {
      // Direct WebSerial dispatch if board is connected locally via USB
      if (serialManager && isSerialConnected) {
        if (command === 'OPEN') serialManager.sendCommand('MOTOR_OPEN\n');
        else if (command === 'CLOSE') serialManager.sendCommand('MOTOR_CLOSE\n');
        else if (command === 'STOP') serialManager.sendCommand('MOTOR_STOP\n');
        else if (command === 'MOMENTARY_OPEN') serialManager.sendCommand('MOMENTARY_OPEN\n');
        else if (command === 'MOMENTARY_CLOSE') serialManager.sendCommand('MOMENTARY_CLOSE\n');
      }

      try {
        const res = await fetch('/api/motor-control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            command,
            source: 'HOME_PAGE_TEST',
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.motorPing) setMotorPing(data.motorPing);
          await fetchRoofState();
        }
      } catch (err) {
        console.error('Failed to execute direct motor test:', err);
      }
    },
    [serialManager, isSerialConnected, fetchRoofState]
  );

  // USB Web Serial Connection Handlers
  const handleConnectUsb = useCallback(async () => {
    setSerialError(null);
    const manager = new WebSerialConnection(
      (data) => {
        setIsSensorOnline(true);
        setLastSeenSeconds(0);
        setPacketCount((prev) => prev + 1);
        const record: SensorTelemetry = {
          temperature: data.temperature,
          humidity: data.humidity,
          dht_connected: data.dht_connected,
          rain_analog: data.rain_analog,
          rain_digital: data.rain_digital,
          rain: data.rain,
          rain_connected: data.rain_connected,
          light: data.light,
          light_connected: data.light_connected,
          wifi_rssi: data.wifi_rssi,
          timestamp: Date.now(),
          receivedAt: new Date().toISOString(),
        };
        setTelemetry(record);

        fetch('/api/sensor-data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        }).catch(() => {});
      },
      (connected) => {
        setIsSerialConnected(connected);
        if (connected) {
          setIsSensorOnline(true);
        }
      },
      (errMsg) => {
        setSerialError(errMsg);
      }
    );

    const ok = await manager.connect();
    if (ok) {
      setSerialManager(manager);
    }
  }, []);

  const handleDisconnectUsb = useCallback(async () => {
    if (serialManager) {
      await serialManager.disconnect();
      setSerialManager(null);
    }
    setIsSerialConnected(false);
  }, [serialManager]);

  // Reset ESP32 Connection
  const handleResetConnection = async () => {
    if (serialManager) {
      await serialManager.disconnect();
      setSerialManager(null);
    }
    setIsSerialConnected(false);
    setTelemetry(null);
    setIsSensorOnline(false);
    setPacketCount(0);
    setLastActuatorAction('Waiting for ESP32 connection...');
    await fetch('/api/sensor-disconnect', { method: 'POST' });
  };

  // Synchronize roof status strictly with physical position and active canopy state
  const isRoofPhysicallyClosed =
    roofPersistentState?.physicalRoofPosition === 'CLOSED' ||
    roofPersistentState?.lastCompletedAction === 'CLOSED' ||
    systemState?.tarpaulin?.physicalPosition === 'CLOSED' ||
    systemState?.tarpaulin?.lastDecision === 'CLOSED' ||
    canopyMode === 'CLOSED' ||
    lastActuatorAction.includes('CLOSED');

  const isRoofMoving =
    roofPersistentState?.physicalRoofPosition === 'OPENING' ||
    roofPersistentState?.physicalRoofPosition === 'CLOSING' ||
    systemState?.tarpaulin?.physicalPosition === 'OPENING' ||
    systemState?.tarpaulin?.physicalPosition === 'CLOSING';

  const isRoofClosed = isRoofPhysicallyClosed;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-sky-500 selection:text-white overflow-x-hidden">
      {/* Top Header: Clean, Compact, Mobile-First (Guaranteed Zero Overflow on Android) */}
      <header className="border-b border-slate-800/80 bg-slate-950/95 backdrop-blur-md px-2.5 sm:px-4 py-2 sticky top-0 z-30 shadow-md">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-1.5 sm:gap-2">
          {/* Left: Hamburger menu + Logo + Title (truncates smoothly on narrow screens) */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
            <button
              id="mobile-sidebar-toggle-btn"
              onClick={() => setIsSidebarOpen(true)}
              className="p-1.5 -ml-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/80 border border-slate-800 focus:outline-hidden cursor-pointer shrink-0"
              title="Open Navigation Menu"
              aria-label="Open Navigation Menu"
            >
              <Menu className="w-4 h-4 sm:w-5 sm:h-5 text-slate-200" />
            </button>
            <div className="flex items-center gap-1.5 cursor-pointer min-w-0" onClick={() => setActiveTab('HOME')}>
              <ArecaDryerLogo size={24} />
              <h1 className="text-xs sm:text-sm font-extrabold text-white tracking-tight truncate max-w-[100px] xs:max-w-[160px] sm:max-w-none">
                ArecaGuard
              </h1>
            </div>
            <span
              className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded border shrink-0 ${
                isRoofMoving
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 animate-pulse'
                  : isRoofPhysicallyClosed
                  ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                  : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
              }`}
            >
              {isRoofMoving
                ? (roofPersistentState?.physicalRoofPosition === 'OPENING' || systemState?.tarpaulin?.physicalPosition === 'OPENING' ? 'OPENING...' : 'CLOSING...')
                : (isRoofPhysicallyClosed ? 'CLOSED' : 'OPEN')}
            </span>
          </div>

          {/* Right Header Controls - Clean, Responsive, Zero Overflow */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            {/* Direct App Link Button (Opens real app in new standalone tab to avoid AI Studio wrapper) */}
            <button
              id="header-open-direct-btn"
              onClick={() => window.open(window.location.origin || window.location.href, '_blank', 'noopener,noreferrer')}
              className="p-1.5 sm:px-2.5 sm:py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/50 text-sky-300 text-xs font-bold flex items-center gap-1 cursor-pointer transition-all shrink-0 shadow-xs"
              title="Open ArecaGuard in new standalone browser window (Direct App URL)"
            >
              <ExternalLink className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-[11px] hidden md:inline">Open App</span>
            </button>

            {/* Download / Install App Guide Button */}
            <button
              id="header-install-app-btn"
              onClick={() => setIsInstallModalOpen(true)}
              className="p-1.5 sm:px-2.5 sm:py-1 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 text-emerald-300 text-xs font-bold flex items-center gap-1 cursor-pointer transition-all shrink-0 shadow-xs"
              title="Install ArecaGuard Standalone App"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] hidden sm:inline">Install</span>
            </button>


            {/* Top Sheet Test Button (Inching & Precision Alignment) */}
            <button
              id="header-sheet-test-btn"
              onClick={() => setIsTestModalOpen(true)}
              className="p-1.5 sm:px-2 sm:py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-slate-300 hover:text-white text-xs font-semibold flex items-center gap-1 cursor-pointer transition-all shrink-0 shadow-xs"
              title="Sheet Precision Alignment & Long-Press Inching Test"
            >
              <Wrench className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-[11px] hidden lg:inline">Test</span>
            </button>

            {/* Settings Button */}
            <button
              id="header-settings-btn"
              onClick={() => openSettingsWithTab('HEATER')}
              className="p-1.5 sm:px-2 sm:py-1 rounded-lg bg-amber-500/20 border border-amber-500/50 text-amber-300 hover:bg-amber-500/30 text-xs font-bold flex items-center gap-1 cursor-pointer transition-all shrink-0 shadow-xs"
              title="Farm & Motor Settings"
            >
              <Sliders className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] hidden lg:inline">Settings</span>
            </button>
          </div>
        </div>
      </header>

      {/* Top 3-Mode Decision Control Bar (Sensors Mode | Forecast Mode | Combined Mode) */}
      <TopControlModeBar
        decisionMode={decisionMode}
        onSelectMode={handleSetDecisionMode}
        sunlightPercent={sunlightPercent}
        isRainWet={isRainWet}
        isNight={isNightCalculated}
        radarSummary={radarSummary}
        weather={weather}
        canopyMode={canopyMode}
        isSensorOnline={isSensorOnline}
        isModeModalOpen={isModeModalOpen}
        setIsModeModalOpen={setIsModeModalOpen}
        rainProbability={systemState?.prediction?.rain_probability}
        cloudCover={weather?.current?.cloud_cover}
        systemState={systemState}
      />

      {/* Mobile & Responsive Slide-Over Sidebar Drawer */}
      {isSidebarOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity"
            onClick={() => setIsSidebarOpen(false)}
          />

          {/* Drawer Container */}
          <div className="relative flex-1 flex flex-col max-w-xs w-full bg-slate-950 border-r border-slate-800 shadow-2xl z-50 animate-in slide-in-from-left duration-200">
            {/* Drawer Header */}
            <div className="p-4 border-b border-slate-800/80 flex items-center justify-between bg-slate-900/60">
              <div className="flex items-center gap-2">
                <ArecaDryerLogo size={28} />
                <div>
                  <h2 className="text-sm font-bold text-white tracking-tight">{t.appTitle}</h2>
                  <p className="text-[10px] text-slate-400">Autonomous Weather & Hardware</p>
                </div>
              </div>
              <button
                onClick={() => setIsSidebarOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Hardware Status Card */}
            <div className="p-3 mx-3 my-3 rounded-xl bg-slate-900/80 border border-slate-800 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-[11px]">ESP32 Hardware</span>
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    isSensorOnline
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  }`}
                >
                  {isSensorOnline ? 'Online' : 'Offline'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between">
                <span>Active Roof State:</span>
                <span className={`font-bold ${isRoofClosed ? 'text-rose-400' : 'text-emerald-400'}`}>
                  {isRoofClosed ? 'Closed (Covered)' : 'Open (Sun Drying)'}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center justify-between">
                <span>Location:</span>
                <button
                  onClick={() => {
                    setIsSidebarOpen(false);
                    setIsLocationModalOpen(true);
                  }}
                  className="font-semibold text-sky-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <MapPin className="w-3 h-3" />
                  <span className="truncate max-w-[120px]">{selectedLocation.name}</span>
                  <Edit3 className="w-2.5 h-2.5" />
                </button>
              </div>

              {/* Quick 3-Mode Selector in Mobile Drawer */}
              <div className="pt-2 border-t border-slate-800/80">
                <span className="text-[10px] text-slate-400 block mb-1.5 font-bold uppercase tracking-wider">Decision Mode</span>
                <div className="grid grid-cols-3 gap-1">
                  <button
                    onClick={() => {
                      handleSetDecisionMode('SENSOR_ONLY');
                      setIsSidebarOpen(false);
                    }}
                    className={`px-1.5 py-1.5 rounded-lg text-[10px] font-bold flex flex-col items-center gap-0.5 border cursor-pointer ${
                      decisionMode === 'SENSOR_ONLY'
                        ? 'bg-emerald-500/30 text-emerald-200 border-emerald-500/70'
                        : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <Radio className="w-3 h-3" />
                    <span>1. Sensors</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSetDecisionMode('INTERNET_ONLY');
                      setIsSidebarOpen(false);
                    }}
                    className={`px-1.5 py-1.5 rounded-lg text-[10px] font-bold flex flex-col items-center gap-0.5 border cursor-pointer ${
                      decisionMode === 'INTERNET_ONLY'
                        ? 'bg-sky-500/30 text-sky-200 border-sky-500/70'
                        : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <CloudRain className="w-3 h-3" />
                    <span>2. Forecast</span>
                  </button>
                  <button
                    onClick={() => {
                      handleSetDecisionMode('COMBO');
                      setIsSidebarOpen(false);
                    }}
                    className={`px-1.5 py-1.5 rounded-lg text-[10px] font-bold flex flex-col items-center gap-0.5 border cursor-pointer ${
                      decisionMode === 'COMBO'
                        ? 'bg-amber-500/30 text-amber-200 border-amber-500/70'
                        : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    <Sparkles className="w-3 h-3" />
                    <span>3. Combo</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Navigation Tabs */}
            <div className="flex-1 overflow-y-auto px-3 space-y-1">
              {/* Install App Banner in Mobile Drawer */}
              <button
                onClick={() => {
                  setIsSidebarOpen(false);
                  setIsInstallModalOpen(true);
                }}
                className="w-full my-1 p-2.5 rounded-xl bg-gradient-to-r from-emerald-600 via-teal-600 to-sky-600 text-white flex items-center gap-2.5 text-left cursor-pointer shadow-md hover:opacity-95 transition-all"
              >
                <div className="p-1.5 rounded-lg bg-slate-950/40 shrink-0">
                  <Download className="w-4 h-4 text-emerald-300" />
                </div>
                <div>
                  <div className="text-xs font-bold flex items-center gap-1">
                    <span>Install ArecaGuard</span>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-white/20 font-mono">App</span>
                  </div>
                  <div className="text-[10px] text-emerald-100">Standalone Home Screen App</div>
                </div>
              </button>

              <p className="px-2 pt-2 text-[10px] uppercase font-mono tracking-wider text-slate-400">Navigation</p>

              <button
                onClick={() => {
                  setActiveTab('HOME');
                  setIsSidebarOpen(false);
                }}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-3 transition-colors cursor-pointer ${
                  activeTab === 'HOME'
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <Activity className="w-4 h-4 text-amber-400" />
                <div className="text-left">
                  <div className="font-bold">Home Dashboard</div>
                  <div className="text-[10px] text-slate-400">Live AI Orb &amp; Roof Slider</div>
                </div>
              </button>

              <button
                onClick={() => {
                  setActiveTab('RADAR_MAP');
                  setIsSidebarOpen(false);
                }}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-3 transition-colors cursor-pointer ${
                  activeTab === 'RADAR_MAP'
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <Compass className="w-4 h-4 text-indigo-400" />
                <div className="text-left">
                  <div className="font-bold">Geographic Radar &amp; 10km Shield</div>
                  <div className="text-[10px] text-slate-400">30km Default Scope + 10km Protection</div>
                </div>
              </button>

              <button
                onClick={() => {
                  setActiveTab('COMPARISON');
                  setIsSidebarOpen(false);
                }}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-3 transition-colors cursor-pointer ${
                  activeTab === 'COMPARISON'
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <Layers className="w-4 h-4 text-sky-400" />
                <div className="text-left">
                  <div className="font-bold">Sensor vs Internet Comparison</div>
                  <div className="text-[10px] text-slate-400">Dual-stream telemetry verification</div>
                </div>
              </button>

              <button
                onClick={() => {
                  setActiveTab('ANALYTICS');
                  setIsSidebarOpen(false);
                }}
                className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-3 transition-colors cursor-pointer ${
                  activeTab === 'ANALYTICS'
                    ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/40'
                    : 'text-slate-300 hover:bg-slate-900 hover:text-white'
                }`}
              >
                <Activity className="w-4 h-4 text-sky-400" />
                <div className="text-left">
                  <div className="font-bold">Forecast, Sensor &amp; Logs</div>
                  <div className="text-[10px] text-slate-400">Decision engine &amp; telemetry logs</div>
                </div>
              </button>

              {/* Quick Actions & Tools */}
              <p className="px-2 pt-4 text-[10px] uppercase font-mono tracking-wider text-slate-400">Quick Tools</p>

              <button
                onClick={() => {
                  setIsSidebarOpen(false);
                  setIsTestModalOpen(true);
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-medium text-sky-300 hover:bg-slate-900 flex items-center gap-3 cursor-pointer transition-colors border border-sky-500/30 bg-sky-500/10"
              >
                <Wrench className="w-4 h-4 text-sky-400" />
                <span>Sheet Precision Test &amp; Inching</span>
              </button>

              <button
                onClick={() => openSettingsWithTab('HEATER')}
                className="w-full px-3 py-2 rounded-xl text-xs font-medium text-amber-300 hover:bg-slate-900 flex items-center gap-3 cursor-pointer transition-colors border border-amber-500/30 bg-amber-500/10"
              >
                <Sliders className="w-4 h-4 text-amber-400" />
                <span>Farm &amp; Motor Settings</span>
              </button>

              <button
                onClick={() => {
                  setIsSidebarOpen(false);
                  setIsRadarModalOpen(true);
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-900 hover:text-white flex items-center gap-3 cursor-pointer transition-colors"
              >
                <Radar className="w-4 h-4 text-indigo-400" />
                <span>30km Radar &amp; Telegram Bot</span>
              </button>

              <button
                onClick={() => {
                  openSettingsWithTab('ESP_CODE');
                }}
                className="w-full px-3 py-2.5 rounded-xl text-xs font-bold text-emerald-300 hover:bg-slate-900 hover:text-white flex items-center justify-between cursor-pointer transition-colors border border-emerald-500/40 bg-emerald-500/10"
              >
                <div className="flex items-center gap-3">
                  <Code className="w-4 h-4 text-emerald-400" />
                  <span>ESP32 Arduino Code (.ino)</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-bold">
                  Inside Settings
                </span>
              </button>

              <button
                onClick={() => {
                  setIsSidebarOpen(false);
                  handleConnectUsb();
                }}
                className="w-full px-3 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-900 hover:text-white flex items-center gap-3 cursor-pointer transition-colors"
              >
                <Cable className="w-4 h-4 text-emerald-400" />
                <span>USB Serial Connect</span>
              </button>
            </div>

            {/* Quick Roof Manual Controls in Drawer */}
            <div className="p-3 border-t border-slate-800/80 bg-slate-900/40">
              <p className="text-[10px] uppercase font-mono text-slate-400 mb-2">Manual Roof Override</p>
              <div className="grid grid-cols-3 gap-1.5 text-xs">
                <button
                  onClick={() => {
                    handleSetCanopyMode('OPEN');
                    setIsSidebarOpen(false);
                  }}
                  className={`p-2 rounded-lg font-bold flex flex-col items-center gap-1 cursor-pointer transition-all ${
                    canopyMode === 'OPEN'
                      ? 'bg-emerald-500 text-white shadow-xs'
                      : 'bg-slate-800 text-emerald-400 hover:bg-slate-700'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span className="text-[10px]">Open</span>
                </button>

                <button
                  onClick={() => {
                    handleSetCanopyMode('AUTO');
                    setIsSidebarOpen(false);
                  }}
                  className={`p-2 rounded-lg font-bold flex flex-col items-center gap-1 cursor-pointer transition-all ${
                    canopyMode === 'AUTO'
                      ? 'bg-amber-500 text-slate-950 shadow-xs'
                      : 'bg-slate-800 text-amber-400 hover:bg-slate-700'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="text-[10px]">Auto</span>
                </button>

                <button
                  onClick={() => {
                    handleSetCanopyMode('CLOSED');
                    setIsSidebarOpen(false);
                  }}
                  className={`p-2 rounded-lg font-bold flex flex-col items-center gap-1 cursor-pointer transition-all ${
                    canopyMode === 'CLOSED'
                      ? 'bg-rose-500 text-white shadow-xs'
                      : 'bg-slate-800 text-rose-400 hover:bg-slate-700'
                  }`}
                >
                  <Shield className="w-3.5 h-3.5" />
                  <span className="text-[10px]">Close</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Primary Navigation Tabs */}
      <nav className="bg-slate-950 border-b border-slate-800/60 px-3 sm:px-4 pt-1.5">
        <div className="max-w-4xl mx-auto flex items-center gap-1 overflow-x-auto no-scrollbar">
          <button
            onClick={() => setActiveTab('HOME')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'HOME'
                ? 'border-amber-500 text-white bg-slate-900/90 shadow-sm'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            <span>Home</span>
          </button>

          <button
            onClick={() => setActiveTab('RADAR_MAP')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'RADAR_MAP'
                ? 'border-indigo-500 text-white bg-slate-900/90 shadow-sm'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Compass className="w-3.5 h-3.5 text-indigo-400" />
            <span>Radar (30km)</span>
          </button>

          <button
            onClick={() => setActiveTab('COMPARISON')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'COMPARISON'
                ? 'border-sky-500 text-white bg-slate-900/90 shadow-sm'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Layers className="w-3.5 h-3.5 text-sky-400" />
            <span>Comparison</span>
          </button>

          <button
            onClick={() => setActiveTab('ANALYTICS')}
            className={`px-3 py-1.5 rounded-t-lg text-xs font-bold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'ANALYTICS'
                ? 'border-indigo-500 text-white bg-slate-900/90 shadow-sm'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            <span>Sensor &amp; Logs</span>
          </button>
        </div>
      </nav>

      {/* Tab Content Views */}
      <main className="flex-1 max-w-4xl lg:max-w-6xl w-full mx-auto p-2.5 sm:p-4 pb-20">
        {/* Tab 1: Clean Minimalist Home */}
        {activeTab === 'HOME' && (
          <div className="space-y-3">
            {/* Location Bar with Centered Highlighted Current Weather Temperature */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl px-3 py-2 flex items-center justify-between gap-2 shadow-sm">
              {/* Left: Location Details */}
              <div className="flex items-center gap-1.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 shrink-0">
                  <MapPin className="w-3.5 h-3.5" />
                </div>
                <div className="truncate">
                  <div className="flex items-center gap-1">
                    <span className="font-bold text-white text-xs truncate">
                      {selectedLocation.name}
                    </span>
                    {selectedLocation.region && (
                      <span className="text-[10px] text-slate-400 hidden sm:inline truncate">
                        &bull; {selectedLocation.region}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] font-mono text-slate-500 block truncate">
                    {selectedLocation.latitude.toFixed(2)}°N, {selectedLocation.longitude.toFixed(2)}°E
                  </span>
                </div>
              </div>

              {/* Center: Highlighted Current Weather Temperature */}
              <div
                id="centered-current-temperature-badge"
                className="flex items-center justify-center shrink-0"
              >
                <div className="px-3 sm:px-4 py-1 rounded-xl bg-gradient-to-r from-amber-500/20 via-amber-400/25 to-amber-500/20 border border-amber-400/60 shadow-md shadow-amber-950/40 flex items-center gap-1.5 sm:gap-2">
                  {weather?.current?.precipitation && weather.current.precipitation > 0 ? (
                    <CloudRain className="w-4 h-4 text-sky-400 shrink-0" />
                  ) : (
                    <Sun className="w-4 h-4 text-amber-400 shrink-0 animate-spin-slow" />
                  )}
                  <div className="flex items-baseline">
                    <span className="text-base sm:text-lg font-black text-white tracking-tight">
                      {weather?.current ? weather.current.temperature_2m.toFixed(1) : '--'}
                    </span>
                    <span className="text-xs font-bold text-amber-300 ml-0.5">°C</span>
                  </div>
                  {weather?.current?.relative_humidity_2m !== undefined && (
                    <span className="text-[10px] font-semibold text-slate-300 hidden xs:inline border-l border-amber-400/30 pl-1.5">
                      {weather.current.relative_humidity_2m}% RH
                    </span>
                  )}
                </div>
              </div>

              {/* Right: Location Edit Button */}
              <button
                id="location-edit-pencil-btn"
                onClick={() => setIsLocationModalOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-slate-700 hover:border-sky-500/50 text-slate-300 hover:text-white text-xs font-semibold shrink-0 cursor-pointer transition-colors shadow-xs"
                title="Change forecast location"
              >
                <Edit3 className="w-3.5 h-3.5 text-sky-400" />
                <span className="text-[11px] hidden xs:inline">Edit</span>
              </button>
            </div>

            {/* Solar Sunrise & Sunset Time Display (Simple, Clean, Non-Button) */}
            <div
              id="home-solar-ephemeris-top-bar"
              className="bg-slate-900/60 border border-slate-800/80 rounded-xl px-3 py-2 flex items-center justify-between gap-2.5 text-xs shadow-xs flex-wrap sm:flex-nowrap"
            >
              {/* Left: Simple sunrise and sunset timestamps (NOT buttons) */}
              <div className="flex items-center gap-3 text-slate-300">
                <div className="flex items-center gap-1.5" title="Local sunrise time">
                  <Sunrise className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-[11px] text-slate-400">Rise:</span>
                  <span className="font-bold text-white text-xs">{solarSunriseTime}</span>
                </div>
                <span className="text-slate-700">|</span>
                <div className="flex items-center gap-1.5" title="Local sunset time (Canopy closes automatically after sunset)">
                  <Sunset className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                  <span className="text-[11px] text-slate-400">Set:</span>
                  <span className="font-bold text-white text-xs">{solarSunsetTime}</span>
                </div>
              </div>

              {/* Right: Informational Solar Cycle State (Non-button, text indicator) */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-[11px]">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${isSolarSunsetted || isSolarPreSunrise ? 'bg-indigo-400' : 'bg-emerald-400'}`} />
                  <span className={isSolarSunsetted || isSolarPreSunrise ? 'text-indigo-300 font-medium' : 'text-emerald-300 font-medium'}>
                    {isSolarSunsetted ? (
                      <>
                        <span className="hidden sm:inline">Sunset Passed (Night Dew Guard Closed)</span>
                        <span className="sm:hidden">Sunset (Closed)</span>
                      </>
                    ) : isSolarPreSunrise ? (
                      <>
                        <span className="hidden sm:inline">Pre-Dawn (Dew Guard Closed)</span>
                        <span className="sm:hidden">Pre-Dawn (Closed)</span>
                      </>
                    ) : (
                      <>
                        <span className="hidden sm:inline">Daylight (Sun Drying Open)</span>
                        <span className="sm:hidden">Daylight (Open)</span>
                      </>
                    )}
                  </span>
                </div>

                {/* Small Lock status chip */}
                {canopyMode === 'AUTO' && (
                  <span className="hidden xs:inline-flex items-center gap-1 text-[10px] text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded-md border border-slate-700/60 font-mono">
                    <Lock className="w-2.5 h-2.5 text-emerald-400" />
                    Auto Locked
                  </span>
                )}
              </div>
            </div>

            {/* Desktop 2-Column or Mobile Stacked Arrangement */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-start">
              {/* Left Column (Main Live Arbiter Orb) */}
              <div className="lg:col-span-6 flex flex-col items-center justify-center bg-slate-900/40 border border-slate-800/60 rounded-3xl p-3 sm:p-4 shadow-sm w-full">
                <AiCenterScenarioOrb
                  sensorData={telemetry}
                  weatherData={weather}
                  decisionMode={decisionMode}
                  canopyMode={canopyMode}
                  isSensorOnline={isSensorOnline}
                  lastSeenSeconds={lastSeenSeconds}
                  locationName={selectedLocation.name}
                  language={language}
                  prediction={prediction}
                  roofState={roofPersistentState}
                  systemState={systemState}
                  onRefresh={handleTriggerAiAnalysis}

                  onOpenSensorDetails={() => setSourceModalType('SENSOR')}
                  onOpenInternetDetails={() => setSourceModalType('INTERNET')}
                  onExecuteCanopyCommand={handleSetCanopyMode}
                />
              </div>

              {/* Right Column (Interactive Roof Slider + AI Guardian Suggestion) */}
              <div className="lg:col-span-6 space-y-3 w-full">
                <CanopyFieldSlider
                  canopyMode={canopyMode}
                  onSetCanopyMode={handleSetCanopyMode}
                  isRainThreat={(() => {
                    const isSunlightActive = Boolean(
                      telemetry &&
                      !telemetry.rain &&
                      telemetry.rain_analog !== null &&
                      telemetry.rain_analog >= 2800 &&
                      telemetry.light !== null &&
                      telemetry.light < (motorSettings?.sunlightDayLuxAdc || 2600)
                    );
                    if (isSunlightActive) {
                      return Boolean(telemetry?.rain && telemetry?.rain_verified);
                    }
                    return (
                      Boolean(telemetry?.rain) ||
                      Boolean(telemetry?.rain_verified) ||
                      getGoogleRainAnalysis(weather).isRainThreat
                    );
                  })()}
                  motorSettings={motorSettings}
                  roofState={roofPersistentState}
                  onEmergencyStop={handleEmergencyStop}
                  onResumeStart={handleResumeStart}
                  onDirectMotorTest={handleDirectMotorTest}
                  onOpenTestModal={() => setIsTestModalOpen(true)}
                  onViewLogs={() => setActiveTab('ANALYTICS')}
                />

                <AiSuggestionStrip
                  sensorData={telemetry}
                  weatherData={weather}
                  canopyMode={canopyMode}
                  motorSettings={motorSettings}
                />
              </div>
            </div>

            {/* Full Width Hourly Timeline Slider */}
            <HourlyForecastSlider
              weatherData={weather}
              telemetry={telemetry}
            />
          </div>
        )}

        {/* Tab: 30km Regional Radar & Interactive Weather Map */}
        {activeTab === 'RADAR_MAP' && (
          <RadarMapTab
            selectedLocation={selectedLocation}
            telemetry={telemetry}
            language={language}
            canopyMode={canopyMode}
            roofState={roofPersistentState}
            onExecuteRoofCommand={handleSetCanopyMode}
            onOpenSettings={() => openSettingsWithTab('TELEGRAM')}
          />
        )}

        {/* Tab: Dedicated Dual-Stream Comparison Panel */}
        {activeTab === 'COMPARISON' && (
          <FarmComparisonBoard
            selectedLocation={selectedLocation}
            onSelectLocation={handleSelectLocation}
            weather={weather}
            isLoadingWeather={isWeatherLoading}
            isNightCalculated={isNightCalculated}
            telemetry={telemetry}
            isSensorOnline={isSensorOnline}
            packetCount={packetCount}
            lastSeenSeconds={lastSeenSeconds}
            canopyMode={canopyMode}
            decisionMode={decisionMode}
            onOpenCodeModal={() => openSettingsWithTab('ESP_CODE')}
          />
        )}

        {/* Tab 3: Deep AI Predictions & Decision Logs */}
        {activeTab === 'ANALYTICS' && (
          <div className="space-y-3">
            <AIPredictionView
              prediction={prediction}
              sensorTelemetry={telemetry}
              weather={weather}
              isSensorOnline={isSensorOnline}
              language={language}
              isLoading={isAiLoading}
              systemState={systemState}
              telemetryHistory5s={telemetryHistory5s}
              lastAnalyzedTimestamp={lastAnalyzedTimestamp}
              onRefreshPrediction={handleTriggerAiAnalysis}
              onClearHistory={handleClearHistory}
              onApplyCanopyRecommendation={(rec) => {
                handleSetCanopyMode(rec as CanopyMode);
              }}
              onOpenChat={(query) => {
                if (query) setInitialChatPrompt(query);
                setIsChatOpen(true);
              }}
            />

            {/* Full Forensic Diagnostic & Audit Logs */}
            <DiagnosticAuditLog
              isEmergencyStopped={canopyMode === 'STOPPED' || Boolean(roofPersistentState?.isEmergencyStopped)}
              canopyMode={canopyMode}
              isSensorFlapping={Boolean(telemetry?.isSensorFlapping || (roofPersistentState as any)?.isSensorFlapping)}
            />
          </div>
        )}
      </main>

      {/* Floating AI Chat Assistant Drawer (Kept accessible for direct drawer events) */}
      <AIChatDrawer
        isOpen={isChatOpen}
        onClose={() => {
          setIsChatOpen(false);
          setInitialChatPrompt(null);
        }}
        sensorTelemetry={telemetry}
        weather={weather}
        locationName={selectedLocation.name}
        language={language}
        initialPrompt={initialChatPrompt}
        onClearInitialPrompt={() => setInitialChatPrompt(null)}
      />

      {/* Footer */}
      <footer className="border-t border-slate-900 py-3 px-4 text-center text-xs text-slate-500 bg-slate-950/60 mt-auto">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-1 text-[11px]">
          <span>Areca Farm Smart Dryer &bull; Gemini 3.8 Neural Weather &amp; Hardware Sensor Fusion</span>
          <span className="font-mono text-slate-400">
            ESP32 Pins: DHT22 (D4) &bull; Rain (D34/D27) &bull; LDR (D35) &bull; Relay (D26) &bull; Wi-Fi MQTT
          </span>
        </div>
      </footer>

      {/* Unified Settings Modal (12V Heater, Sensor Calibration, Online Radar, Motor Timers, Wiring & ESP32 Code) */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={motorSettings}
        onSaveSettings={handleSaveMotorSettings}
        motorPing={motorPing}
        onPingMotor={handlePingMotor}
        onTriggerMotorTest={handleTriggerMotorTest}
        heaterState={heaterState}
        onControlHeater={handleControlHeater}
        currentTemperature={telemetry?.dht_connected ? telemetry.temperature : null}
        currentRainAnalog={telemetry?.rain_connected ? telemetry.rain_analog : null}
        currentLightAdc={telemetry?.light_connected ? telemetry.light : null}
        language={language}
        initialTab={settingsInitialTab}
        serverUrl={window.location.origin}
      />

      {/* Instant Location Search & Picker Modal */}
      <LocationPickerModal
        isOpen={isLocationModalOpen}
        onClose={() => setIsLocationModalOpen(false)}
        selectedLocation={selectedLocation}
        onSelectLocation={handleSelectLocation}
      />

      {/* Bubble Source Details Modal (Sensor Database or Google/Internet Weather) */}
      <SourceDetailsModal
        isOpen={Boolean(sourceModalType)}
        onClose={() => setSourceModalType(null)}
        type={sourceModalType}
        sensorData={telemetry}
        isSensorOnline={isSensorOnline}
        weatherData={weather}
        location={selectedLocation}
        lastSeenSeconds={lastSeenSeconds}
        packetCount={packetCount}
      />
      {/* 30km Regional Doppler Radar Grid & Telegram Bot Modal */}
      <Radar30kmModal
        isOpen={isRadarModalOpen}
        onClose={() => setIsRadarModalOpen(false)}
        telemetry={telemetry}
        farmCoordinates={{ lat: selectedLocation.latitude, lon: selectedLocation.longitude }}
      />

      {/* Sheet Precision & Inching Test Modal (Top Test button & Alignment Mode) */}
      <SheetPrecisionTestModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
        roofState={roofPersistentState}
        onMomentaryCommand={handleMomentaryCommand}
        onCalibratePosition={handleCalibratePosition}
        motorSettings={motorSettings}
        onSaveSettings={handleSaveMotorSettings}
      />

      {/* PWA App Download & Install Modal */}
      <InstallAppModal
        isOpen={isInstallModalOpen}
        onClose={() => setIsInstallModalOpen(false)}
        deferredPrompt={deferredPrompt}
      />
    </div>
  );
}
