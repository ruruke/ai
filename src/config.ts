type Config = {
  host: string;
  serverName?: string;
  i: string;
  master?: string;
  wsUrl: string;
  apiUrl: string;
  keywordEnabled: boolean;
  reversiEnabled: boolean;
  notingEnabled: boolean;
  chartEnabled: boolean;
  serverMonitoring: boolean;
  checkEmojisEnabled?: boolean;
  checkEmojisAtOnce?: boolean;
  geminiApiKey?: string;
	geminiModel?: string;
	geminiPostMode?: string;
  prompt?: string;
	autoNotePrompt?: string;
	autoNoteIntervalMinutes?: string;
	geminiAutoNoteProbability?: string;
  aichatRandomTalkEnabled?: string;
  aichatRandomTalkProbability?: string;
  aichatRandomTalkIntervalMinutes?: string;
  mecab?: string;
  mecabDic?: string;
  memoryDir?: string;
  followAllowedHosts?: string[];
  followExcludeInstances?: string[];
  mazeEnable?: boolean;
  pollEnable?: boolean;
  postNotPublic?: boolean;
  defaultVisibility?: string;
};

import { readFile } from 'fs/promises';
const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));

if(!config.followAllowedHosts) config.followAllowedHosts = [];
if(!config.followExcludeInstances) config.followExcludeInstances = [];
if(!config.mazeEnable) config.mazeEnable = false;
if(!config.pollEnable) config.pollEnable = false;
if (!config.defaultVisibility) config.defaultVisibility = "public";
if (config.postNotPublic === undefined) config.postNotPublic = false;

config.wsUrl = config.host.replace('http', 'ws');
config.apiUrl = config.host + '/api';

export default config as Config;
