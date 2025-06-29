type Config = {
  host: string;
  serverName?: string;
  i: string;
  aiName?: string[];
  master?: string;
  wsUrl: string;
  apiUrl: string;
  keywordEnabled: boolean;
  reversiEnabled: boolean;
  notingEnabled: boolean;
  chartEnabled: boolean;
  timeSignalEnabled: boolean;
  serverMonitoring: boolean;
  checkEmojisEnabled?: boolean;
  checkEmojisAtOnce?: boolean;
  gemini?: {
    enabled?: boolean;
    apiKey?: string;
    model?: string;
    autoNote?: {
      enabled?: boolean;
      prompt?: string;
      probability?: number;
      intervalMinutes?: number;
      disableNightPosting?: boolean;
      nightHours?: {
        start?: number;
        end?: number;
      };
    };
    randomTalk?: {
      enabled?: boolean;
      probability?: number;
      intervalMinutes?: number;
      followingOnly?: boolean;
    };
    chat?: {
      enabled?: boolean;
      prompt?: string;
      groundingWithGoogleSearch?: boolean;
    };
  };
  mecab?: string;
  mecabDic?: string;
  memoryDir?: string;
  followAllowedHosts?: string[];
  followExcludeInstances?: string[];
  mazeEnable?: boolean;
  pollEnable?: boolean;
  postNotPublic?: boolean;
  defaultVisibility?: string;
  earthquakeWarning?: {
    minIntensityThreshold?: number;
    minMagunitudeForWeak?: number;
    websocketReconnectMaxAttempts?: number;
    websocketReconnectDelay?: number;
    maxReconnectDelay?: number;
    heartbeatTimeoutMs?: number;
    heartbeatIntervalMs?: number;
  };
  kiatsu?: {
    locationCode?: string;
    requestTimeoutMs?: number;
    maxErrorRetries?: number;
    updateIntervalMs?: number;
    postIntervalMs?: number;
    errorCooldownMs?: number;
    minPostLevel?: number;
  };
  weatherAutoNotePref?: string;
  weatherAutoNoteHour?: number;
  earthquakeEnable?: boolean;
};

import { loadAndMigrateConfig } from './config-migration.js';

// YAML/JSON自動検出・移行機能付き設定読み込み
const config = loadAndMigrateConfig();

if (!config.aiName) config.aiName = ['藍', '三須木'];
if (!config.followAllowedHosts) config.followAllowedHosts = [];
if (!config.followExcludeInstances) config.followExcludeInstances = [];
if (!config.mazeEnable) config.mazeEnable = false;
if (!config.pollEnable) config.pollEnable = false;
if (!config.defaultVisibility) config.defaultVisibility = 'public';
if (config.postNotPublic === undefined) config.postNotPublic = false;

// Gemini設定のデフォルト値
if (!config.gemini) config.gemini = {};
if (config.gemini.enabled === undefined) config.gemini.enabled = true;
if (!config.gemini.model) config.gemini.model = 'gemini-2.0-flash';

// Gemini自動ノート設定
if (!config.gemini.autoNote) config.gemini.autoNote = {};
if (config.gemini.autoNote.enabled === undefined)
  config.gemini.autoNote.enabled = true;
if (config.gemini.autoNote.probability === undefined)
  config.gemini.autoNote.probability = 0.1;
if (config.gemini.autoNote.intervalMinutes === undefined)
  config.gemini.autoNote.intervalMinutes = 60;
if (config.gemini.autoNote.disableNightPosting === undefined)
  config.gemini.autoNote.disableNightPosting = true;
if (!config.gemini.autoNote.nightHours) config.gemini.autoNote.nightHours = {};
if (config.gemini.autoNote.nightHours.start === undefined)
  config.gemini.autoNote.nightHours.start = 23;
if (config.gemini.autoNote.nightHours.end === undefined)
  config.gemini.autoNote.nightHours.end = 5;

// Geminiランダムトーク設定
if (!config.gemini.randomTalk) config.gemini.randomTalk = {};
if (config.gemini.randomTalk.enabled === undefined)
  config.gemini.randomTalk.enabled = true;
if (config.gemini.randomTalk.probability === undefined)
  config.gemini.randomTalk.probability = 0.2;
if (config.gemini.randomTalk.intervalMinutes === undefined)
  config.gemini.randomTalk.intervalMinutes = 60;
if (config.gemini.randomTalk.followingOnly === undefined)
  config.gemini.randomTalk.followingOnly = true;

// Geminiチャット設定
if (!config.gemini.chat) config.gemini.chat = {};
if (config.gemini.chat.enabled === undefined) config.gemini.chat.enabled = true;
if (config.gemini.chat.groundingWithGoogleSearch === undefined)
  config.gemini.chat.groundingWithGoogleSearch = true;

// 地震速報の設定デフォルト値
if (!config.earthquakeWarning) config.earthquakeWarning = {};
if (config.earthquakeWarning.minIntensityThreshold === undefined)
  config.earthquakeWarning.minIntensityThreshold = 3;
if (config.earthquakeWarning.minMagunitudeForWeak === undefined)
  config.earthquakeWarning.minMagunitudeForWeak = 4.0;
// WebSocket関連の設定
if (config.earthquakeWarning.websocketReconnectMaxAttempts === undefined)
  config.earthquakeWarning.websocketReconnectMaxAttempts = 10;
if (config.earthquakeWarning.websocketReconnectDelay === undefined)
  config.earthquakeWarning.websocketReconnectDelay = 5000;
if (config.earthquakeWarning.maxReconnectDelay === undefined)
  config.earthquakeWarning.maxReconnectDelay = 300000;
if (config.earthquakeWarning.heartbeatTimeoutMs === undefined)
  config.earthquakeWarning.heartbeatTimeoutMs = 120000;
if (config.earthquakeWarning.heartbeatIntervalMs === undefined)
  config.earthquakeWarning.heartbeatIntervalMs = 60000;

// 気圧モジュールの設定デフォルト値
if (!config.kiatsu) config.kiatsu = {};
if (config.kiatsu.locationCode === undefined)
  config.kiatsu.locationCode = '13102'; // 東京都中央区
if (config.kiatsu.requestTimeoutMs === undefined)
  config.kiatsu.requestTimeoutMs = 10000;
if (config.kiatsu.maxErrorRetries === undefined)
  config.kiatsu.maxErrorRetries = 5;
if (config.kiatsu.updateIntervalMs === undefined)
  config.kiatsu.updateIntervalMs = 10 * 60 * 1000;
if (config.kiatsu.postIntervalMs === undefined)
  config.kiatsu.postIntervalMs = 12 * 60 * 60 * 1000;
if (config.kiatsu.errorCooldownMs === undefined)
  config.kiatsu.errorCooldownMs = 60 * 60 * 1000;
if (config.kiatsu.minPostLevel === undefined) config.kiatsu.minPostLevel = 2;

// 天気予報自動投稿の設定デフォルト値
if (!config.weatherAutoNotePref) config.weatherAutoNotePref = '東京都';
if (!config.weatherAutoNoteHour) config.weatherAutoNoteHour = 7;

// 地震速報の設定デフォルト値
if (!config.earthquakeEnable) config.earthquakeEnable = true;

// 時刻信号の設定デフォルト値
if (!config.timeSignalEnabled) config.timeSignalEnabled = true;

config.wsUrl = config.host.replace('http', 'ws');
config.apiUrl = config.host + '/api';

export default config as Config;
