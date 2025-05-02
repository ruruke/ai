import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import Message from '@/message.js';
import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import serifs from '../../serifs.js';
import config from '../../config.js';

// 天気種別→絵文字マッピング
function weatherEmoji(telop: string): string {
  if (telop.includes('雷')) return '⚡️';
  if (telop.includes('雪')) return '❄️';
  if (telop.includes('雨')) return '🌧️';
  if (telop.includes('曇')) return '☁️';
  if (telop.includes('晴')) return '☀️';
  return '🌈';
}

// 天気予報メッセージ組み立て
function weatherSerif(
  place: string,
  dateLabel: string,
  telop: string,
  tempMin: string | null,
  tempMax: string | null,
  rain: any
) {
  let rainStr = '';
  if (rain) {
    rainStr = `\n降水確率: 0-6時:${rain.T00_06} 6-12時:${rain.T06_12} 12-18時:${rain.T12_18} 18-24時:${rain.T18_24}`;
  }
  let tempStr = '';
  if (tempMin || tempMax) {
    tempStr = `\n気温: 最低${tempMin ?? '–'}℃ 最高${tempMax ?? '–'}℃`;
  }
  return serifs.weather.forecast(place, dateLabel, telop, tempStr, rainStr);
}

// 地名→ID変換
async function fetchPrefIdMap(): Promise<Record<string, string>> {
  const xmlUrl = 'https://weather.tsukumijima.net/primary_area.xml';
  const xml = (await axios.get(xmlUrl)).data;
  const parser = new XMLParser({ ignoreAttributes: false });
  const obj = parser.parse(xml);
  const map: Record<string, string> = {};
  const prefs = obj.rss.channel['ldWeather:source'].pref;
  for (const pref of prefs) {
    const prefName = pref['@_title'] || pref.title;
    // pref.city[0]['@_id'] で都道府県の代表IDを取得
    if (Array.isArray(pref.city)) {
      map[prefName] = pref.city[0]['@_id'];
    } else if (pref.city) {
      map[prefName] = pref.city['@_id'];
    }
  }
  return map;
}

function autoNoteSerif(telop: string): string {
  if (telop.includes('雷')) return serifs.weather.autoNote.thunder;
  if (telop.includes('雪')) return serifs.weather.autoNote.snowy;
  if (telop.includes('雨')) return serifs.weather.autoNote.rainy;
  if (telop.includes('曇')) return serifs.weather.autoNote.cloudy;
  if (telop.includes('晴')) return serifs.weather.autoNote.sunny;
  return serifs.weather.autoNote.other;
}

function scheduleWeatherAutoNote(
  postWeatherNote: (place: string) => Promise<void>
) {
  // 現在時刻から次の指定時刻までのミリ秒を計算
  const now = new Date();
  const next = new Date(now);
  next.setHours(config.weatherAutoNoteHour ?? 7, 0, 0, 0);
  if (now >= next) next.setDate(next.getDate() + 1);
  const msUntilNext = next.getTime() - now.getTime();
  setTimeout(() => {
    postWeatherNote(config.weatherAutoNotePref ?? '東京都');
    setInterval(
      () => postWeatherNote(config.weatherAutoNotePref ?? '東京都'),
      24 * 60 * 60 * 1000
    );
  }, msUntilNext);
}

async function postWeatherNote(this: any, place: string) {
  try {
    const map = await fetchPrefIdMap();
    let areaId = map[place];
    if (!areaId) {
      const found = Object.entries(map).find(([prefName]) =>
        prefName.startsWith(place)
      );
      if (found) areaId = found[1];
    }
    if (!areaId) return;
    const url = `https://weather.tsukumijima.net/api/forecast/city/${areaId}`;
    const res = await axios.get(url, { timeout: 10000 });
    const data = res.data;
    if (!data || !data.forecasts || !data.location) return;
    const today = data.forecasts[0];
    const todayTempMin = today.temperature?.min?.celsius;
    const todayTempMax = today.temperature?.max?.celsius;
    let text = '';
    text =
      autoNoteSerif(today.telop) +
      '\n' +
      weatherSerif(
        data.title,
        today.dateLabel,
        today.telop,
        todayTempMin,
        todayTempMax,
        today.chanceOfRain
      );
    if (todayTempMin == null && todayTempMax == null) {
      text += '\n' + serifs.weather.noTemp;
    }
    const emoji = weatherEmoji(today.telop);
    // ノート投稿
    this.ai.api('notes/create', { text: text + '\n' + emoji });
  } catch (e) {
    // 失敗時は何もしない
  }
}

export default class extends Module {
  public readonly name = 'weather';

  @bindThis
  public install() {
    scheduleWeatherAutoNote(postWeatherNote.bind(this));
    return {
      mentionHook: this.mentionHook,
    };
  }

  @bindThis
  private async mentionHook(msg: Message) {
    if (!msg.text) return false;
    // コマンド検出
    // 例: てんき 明日 東京, てんき あさって, てんき 東京, てんき
    const match = msg.text.match(
      /(?:天気予報|天気|てんき)[\s　]*(今日|明日|明後日|あした|あさって)?[\s　]*([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}a-zA-Z0-9]+)?/u
    );
    if (!match) return false;
    let day = match[1]?.trim();
    let place = match[2]?.trim();

    // 日付指定がなければ「今日」
    if (!day) day = '今日';
    // 地名がなければconfigの地点
    if (!place) place = config.weatherAutoNotePref ?? '東京都';

    // 日付ラベル正規化
    let dateLabel = '今日';
    if (['明日', 'あした'].includes(day)) dateLabel = '明日';
    else if (['明後日', 'あさって'].includes(day)) dateLabel = '明後日';
    else if (['今日'].includes(day)) dateLabel = '今日';

    // 地名→ID
    let areaId: string | undefined;
    try {
      const map = await fetchPrefIdMap();
      areaId = map[place];
      if (!areaId) {
        // 前方一致で探す
        const found = Object.entries(map).find(([prefName]) =>
          prefName.startsWith(place)
        );
        if (found) {
          areaId = found[1];
        }
      }
    } catch (e) {
      msg.reply(serifs.weather.areaError);
      return { reaction: '❌' };
    }
    if (!areaId) {
      msg.reply(serifs.weather.notFound(place));
      return { reaction: '❌' };
    }

    // APIリクエスト
    try {
      const url = `https://weather.tsukumijima.net/api/forecast/city/${areaId}`;
      const res = await axios.get(url, { timeout: 10000 });
      const data = res.data;
      if (!data || !data.forecasts || !data.location) {
        msg.reply(serifs.weather.fetchError);
        return { reaction: '❌' };
      }
      // 指定日付の天気を探す
      const forecast = data.forecasts.find(
        (f: any) => f.dateLabel === dateLabel
      );
      if (!forecast) {
        msg.reply('その日の天気データが見つかりませんでした。');
        return { reaction: '❌' };
      }
      const tempMin = forecast.temperature?.min?.celsius;
      const tempMax = forecast.temperature?.max?.celsius;
      let line = weatherSerif(
        data.title,
        forecast.dateLabel,
        forecast.telop,
        tempMin,
        tempMax,
        forecast.chanceOfRain
      );
      if (tempMin == null && tempMax == null) {
        line += '\n' + serifs.weather.noTemp;
      }
      msg.reply(line);
      return { reaction: weatherEmoji(forecast.telop) };
    } catch (e) {
      msg.reply(serifs.weather.fetchError);
      return { reaction: '❌' };
    }
  }
}
