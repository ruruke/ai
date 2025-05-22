import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import Message from '@/message.js';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import serifs from '../../serifs.js';
import config from '../../config.js';
import * as mfm from '@/utils/mfm.js';

const WEATHER_API_BASE_URL = 'https://weather.tsukumijima.net';
const PRIMARY_AREA_XML_URL = `${WEATHER_API_BASE_URL}/primary_area.xml`;
const FORECAST_API_URL_BASE = `${WEATHER_API_BASE_URL}/api/forecast/city/`;

const PREF_MAP_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DAILY_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

const DEFAULT_WEATHER_PLACE = config.weatherAutoNotePref ?? '東京都';
const DEFAULT_AUTO_NOTE_HOUR = config.weatherAutoNoteHour ?? 7;

const WEATHER_EMOJI_MAP: Record<string, string> = {
  雷: '⚡️',
  雪: '❄️',
  雨: '🌧️',
  曇: '☁️',
  晴: '☀️',
};
const DEFAULT_WEATHER_EMOJI = '🌈';

const WEATHER_THEME_COLOR_MAP: Record<string, string> = {
  晴: 'ff8c00', // オレンジ
  曇: '778899', // ライトスレートグレー
  雨: '4682b4', // スチールブルー
  雪: 'add8e6', // ライトブルー
  雷: 'ff00ff', // マゼンタ
};
const DEFAULT_THEME_COLOR = '777777'; // グレー

interface WeatherInfo {
  place: string;
  dateLabel: string;
  telop: string;
  tempMin: string | null;
  tempMax: string | null;
  rain: {
    T00_06: string;
    T06_12: string;
    T12_18: string;
    T18_24: string;
  } | null;
  additionalMessage?: string;
  greeting?: string;
}

interface RawForecast {
  dateLabel: string;
  telop: string;
  temperature?: {
    min?: { celsius?: string };
    max?: { celsius?: string };
  };
  chanceOfRain?: WeatherInfo['rain'];
}

interface RawWeatherData {
  title: string;
  forecasts: RawForecast[];
  location?: Record<string, unknown>; // Can be more specific if needed
  error?: string; // API might return error messages
}

let prefMapCache: { data: Record<string, string>; fetchedAt: number } | null =
  null;

function weatherEmoji(telop: string): string {
  for (const keyword in WEATHER_EMOJI_MAP) {
    if (telop.includes(keyword)) {
      return WEATHER_EMOJI_MAP[keyword];
    }
  }
  return DEFAULT_WEATHER_EMOJI;
}

function getRainProbabilityColor(probability: string): string {
  const probNum = parseInt(probability.replace('%', ''), 10);
  if (isNaN(probNum)) return '777777'; // 不明な場合はグレー
  if (probNum === 0) return '32cd32'; // 0% (緑)
  if (probNum <= 20) return '6495ed'; // 1-20% (明るい青)
  if (probNum <= 50) return 'ffa500'; // 21-50% (オレンジ)
  return 'ff4500'; // 51%以上 (赤)
}

function getWeatherThemeColor(telop: string): string {
  for (const keyword in WEATHER_THEME_COLOR_MAP) {
    if (telop.includes(keyword)) {
      return WEATHER_THEME_COLOR_MAP[keyword];
    }
  }
  return DEFAULT_THEME_COLOR;
}

function formatWeatherToMfm(info: WeatherInfo): string {
  const themeColor = getWeatherThemeColor(info.telop);
  const title = `${info.place}の${info.dateLabel}の天気`;
  const emoji = weatherEmoji(info.telop);

  let body = `<center>
${mfm.bold(mfm.color(title, themeColor))} ${emoji}
---
今日の天気は「${mfm.bold(mfm.color(info.telop, themeColor))}」みたいですよ！

`;

  if (info.tempMin || info.tempMax) {
    body += `🌡️ ${mfm.bold('気温')}
最高: ${mfm.color(info.tempMax ?? '?', 'ff4500')}℃
最低: ${mfm.color(info.tempMin ?? '?', '4169e1')}℃

`;
  }

  if (info.rain) {
    body += `☔ ${mfm.bold('降水確率')}
0-6時:  ${mfm.color(info.rain.T00_06, getRainProbabilityColor(info.rain.T00_06))}
6-12時: ${mfm.color(info.rain.T06_12, getRainProbabilityColor(info.rain.T06_12))}
12-18時:${mfm.color(info.rain.T12_18, getRainProbabilityColor(info.rain.T12_18))}
18-24時:${mfm.color(info.rain.T18_24, getRainProbabilityColor(info.rain.T18_24))}

`;
  }

  if (info.additionalMessage) {
    body += `${info.additionalMessage}\n\n`;
  }

  body += `---
</center>
`;

  if (info.greeting) {
    body += `${info.greeting}\n`;
  }

  const closingMessages = [
    '今日も素敵な一日になりますように♪ ✨',
    '良い一日をお過ごしくださいね！ 😊',
    '何か良いことがありますように！ 🍀',
    '頑張ってくださいね！応援しています！ 💪',
    '無理せず、自分のペースでいきましょう。☕',
  ];
  const randomClosingMessage =
    closingMessages[Math.floor(Math.random() * closingMessages.length)];
  body += `${randomClosingMessage}`;

  return body;
}

async function fetchPrefIdMap(): Promise<Record<string, string>> {
  if (
    prefMapCache &&
    Date.now() - prefMapCache.fetchedAt < PREF_MAP_CACHE_TTL_MS
  ) {
    return prefMapCache.data;
  }

  try {
    const response = await axios.get<string>(PRIMARY_AREA_XML_URL, {
      timeout: 10000,
    });
    const xml = response.data;
    const parser = new XMLParser({ ignoreAttributes: false });
    const obj = parser.parse(xml);
    const map: Record<string, string> = {};

    // XML構造が期待通りであることを確認
    const prefs = obj?.rss?.channel?.['ldWeather:source']?.pref;
    if (!Array.isArray(prefs)) {
      console.error('Unexpected XML structure in primary_area.xml:', obj);
      throw new Error('Failed to parse prefecture data from XML.');
    }

    for (const pref of prefs) {
      const prefName = pref['@_title'] || pref.title;
      if (prefName && pref.city) {
        if (
          Array.isArray(pref.city) &&
          pref.city.length > 0 &&
          pref.city[0]['@_id']
        ) {
          map[prefName] = pref.city[0]['@_id'];
        } else if (!Array.isArray(pref.city) && pref.city['@_id']) {
          map[prefName] = pref.city['@_id'];
        }
      }
    }
    prefMapCache = { data: map, fetchedAt: Date.now() };
    return map;
  } catch (error) {
    console.error('Failed to fetch or parse primary_area.xml:', error);
    if (prefMapCache) return prefMapCache.data; // フォールバックとして古いキャッシュを返す
    throw new Error(
      'Failed to fetch prefecture ID map and no cache available.'
    );
  }
}

async function getAreaId(
  place: string,
  map?: Record<string, string>
): Promise<string | undefined> {
  const prefMap = map ?? (await fetchPrefIdMap());
  let areaId = prefMap[place];
  if (!areaId) {
    const found = Object.entries(prefMap).find(([prefName]) =>
      prefName.startsWith(place)
    );
    if (found) areaId = found[1];
  }
  return areaId;
}

async function fetchWeatherData(
  areaId: string
): Promise<RawWeatherData | null> {
  try {
    const url = `${FORECAST_API_URL_BASE}${areaId}`;
    const res = await axios.get<RawWeatherData>(url, { timeout: 10000 });
    if (res.data?.error) {
      console.error(
        `Weather API error for areaId ${areaId}: ${res.data.error}`
      );
      return null;
    }
    if (!res.data || !res.data.forecasts || !res.data.location) {
      console.error('Invalid weather data received:', res.data);
      return null;
    }
    return res.data;
  } catch (error) {
    console.error(`Failed to fetch weather data for areaId ${areaId}:`, error);
    return null;
  }
}

function autoNoteSerif(telop: string): string {
  const serifMap: Record<string, string> = {
    雷: serifs.weather.autoNote.thunder,
    雪: serifs.weather.autoNote.snowy,
    雨: serifs.weather.autoNote.rainy,
    曇: serifs.weather.autoNote.cloudy,
    晴: serifs.weather.autoNote.sunny,
  };
  for (const keyword in serifMap) {
    if (telop.includes(keyword)) {
      return serifMap[keyword];
    }
  }
  return serifs.weather.autoNote.other;
}

export default class WeatherModule extends Module {
  public readonly name = 'weather';

  @bindThis
  public install() {
    this.scheduleWeatherAutoNote();
    return {
      mentionHook: this.mentionHook,
    };
  }

  private scheduleWeatherAutoNote() {
    const now = new Date();
    const nextRunTime = new Date(now);
    nextRunTime.setHours(DEFAULT_AUTO_NOTE_HOUR, 0, 0, 0);
    if (now >= nextRunTime) {
      nextRunTime.setDate(nextRunTime.getDate() + 1);
    }
    const msUntilNext = nextRunTime.getTime() - now.getTime();

    setTimeout(() => {
      this.postWeatherNoteForAuto(DEFAULT_WEATHER_PLACE);
      setInterval(
        () => this.postWeatherNoteForAuto(DEFAULT_WEATHER_PLACE),
        DAILY_INTERVAL_MS
      );
    }, msUntilNext);
  }

  private async postWeatherNoteForAuto(place: string) {
    try {
      const areaId = await getAreaId(place);
      if (!areaId) {
        console.warn(`Area ID not found for auto-note: ${place}`);
        return;
      }

      const weatherData = await fetchWeatherData(areaId);
      if (
        !weatherData ||
        !weatherData.forecasts ||
        weatherData.forecasts.length === 0
      ) {
        console.warn(`No forecast data for auto-note: ${place}`);
        return;
      }

      const todayForecast = weatherData.forecasts[0];
      const weatherInfo: WeatherInfo = {
        place: weatherData.title,
        dateLabel: todayForecast.dateLabel,
        telop: todayForecast.telop,
        tempMin: todayForecast.temperature?.min?.celsius ?? null,
        tempMax: todayForecast.temperature?.max?.celsius ?? null,
        rain: todayForecast.chanceOfRain ?? null,
        greeting: autoNoteSerif(todayForecast.telop),
      };

      if (weatherInfo.tempMin == null && weatherInfo.tempMax == null) {
        weatherInfo.additionalMessage = serifs.weather.noTemp;
      }

      const text = formatWeatherToMfm(weatherInfo);
      this.ai.api('notes/create', { text: text });
    } catch (e) {
      console.error('Error in postWeatherNoteForAuto:', e);
    }
  }

  @bindThis
  private async mentionHook(msg: Message) {
    if (!msg.text) return false;

    const match = msg.text.match(
      /(?:天気予報|天気|てんき)[\s　]*(今日|明日|明後日|あした|あさって)?[\s　]*([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}a-zA-Z0-9]+)?/u
    );
    if (!match) return false;

    let dayInput = match[1]?.trim();
    let placeInput = match[2]?.trim();

    const dateLabel = this.normalizeDateLabel(dayInput);
    const place = placeInput || DEFAULT_WEATHER_PLACE;

    let areaId: string | undefined;
    try {
      areaId = await getAreaId(place);
    } catch (e) {
      console.error(
        `Error fetching prefIdMap for mentionHook (place: ${place}):`,
        e
      );
      msg.reply(serifs.weather.areaError);
      return { reaction: '❌' };
    }

    if (!areaId) {
      msg.reply(serifs.weather.notFound(place));
      return { reaction: '❌' };
    }

    const weatherData = await fetchWeatherData(areaId);
    if (!weatherData) {
      msg.reply(serifs.weather.fetchError);
      return { reaction: '❌' };
    }

    const forecast = weatherData.forecasts.find(
      (f: RawForecast) => f.dateLabel === dateLabel
    );
    if (!forecast) {
      msg.reply(`${dateLabel}の天気データが見つかりませんでした。`);
      return { reaction: '❌' };
    }

    const weatherInfo: WeatherInfo = {
      place: weatherData.title,
      dateLabel: forecast.dateLabel,
      telop: forecast.telop,
      tempMin: forecast.temperature?.min?.celsius ?? null,
      tempMax: forecast.temperature?.max?.celsius ?? null,
      rain: forecast.chanceOfRain ?? null,
    };

    if (weatherInfo.tempMin == null && weatherInfo.tempMax == null) {
      weatherInfo.additionalMessage = serifs.weather.noTemp;
    }

    const replyText = formatWeatherToMfm(weatherInfo);
    msg.reply(replyText);
    return { reaction: weatherEmoji(forecast.telop) };
  }

  private normalizeDateLabel(dayInput?: string): string {
    if (!dayInput) return '今日';
    if (['明日', 'あした'].includes(dayInput)) return '明日';
    if (['明後日', 'あさって'].includes(dayInput)) return '明後日';
    return '今日';
  }
}
