import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

// 旧形式の設定型定義
interface LegacyConfig {
  geminiApiKey?: string;
  geminiModel?: string;
  geminiPostMode?: string;
  prompt?: string;
  autoNotePrompt?: string;
  autoNoteIntervalMinutes?: number;
  autoNoteDisableNightPosting?: boolean;
  geminiAutoNoteProbability?: number;
  aichatRandomTalkEnabled?: boolean;
  aichatRandomTalkProbability?: number;
  aichatRandomTalkIntervalMinutes?: number;
  aichatGroundingWithGoogleSearchAlwaysEnabled?: boolean;
  [key: string]: any;
}

// 新形式の設定型定義
interface NewConfig {
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
  [key: string]: any;
}

/**
 * 旧形式から新形式に変換
 */
export function migrateLegacyConfig(legacyConfig: LegacyConfig): NewConfig {
  const newConfig: NewConfig = { ...legacyConfig };

  // Gemini設定の統合
  if (
    legacyConfig.geminiApiKey ||
    legacyConfig.geminiModel ||
    legacyConfig.prompt ||
    legacyConfig.autoNotePrompt ||
    legacyConfig.aichatRandomTalkEnabled !== undefined
  ) {
    newConfig.gemini = {
      enabled: true,
      apiKey: legacyConfig.geminiApiKey,
      model: legacyConfig.geminiModel || 'gemini-2.5-flash',

      autoNote: {
        enabled:
          legacyConfig.geminiPostMode === 'auto' ||
          legacyConfig.geminiPostMode === 'both',
        prompt: legacyConfig.autoNotePrompt,
        probability: legacyConfig.geminiAutoNoteProbability || 0.1,
        intervalMinutes: legacyConfig.autoNoteIntervalMinutes || 60,
        disableNightPosting: legacyConfig.autoNoteDisableNightPosting !== false,
        nightHours: {
          start: 23,
          end: 5,
        },
      },

      randomTalk: {
        enabled: legacyConfig.aichatRandomTalkEnabled || false,
        probability: legacyConfig.aichatRandomTalkProbability || 0.2,
        intervalMinutes: legacyConfig.aichatRandomTalkIntervalMinutes || 60,
        followingOnly: true,
      },

      chat: {
        enabled: true,
        prompt: legacyConfig.prompt,
        groundingWithGoogleSearch:
          legacyConfig.aichatGroundingWithGoogleSearchAlwaysEnabled || false,
      },
    };

    // 旧設定項目を削除
    delete newConfig.geminiApiKey;
    delete newConfig.geminiModel;
    delete newConfig.geminiPostMode;
    delete newConfig.prompt;
    delete newConfig.autoNotePrompt;
    delete newConfig.autoNoteIntervalMinutes;
    delete newConfig.autoNoteDisableNightPosting;
    delete newConfig.geminiAutoNoteProbability;
    delete newConfig.aichatRandomTalkEnabled;
    delete newConfig.aichatRandomTalkProbability;
    delete newConfig.aichatRandomTalkIntervalMinutes;
    delete newConfig.aichatGroundingWithGoogleSearchAlwaysEnabled;
  }

  return newConfig;
}

/**
 * 設定ファイルを自動検出・読み込み・変換
 */
export function loadAndMigrateConfig(): any {
  const configDir = process.cwd();
  const yamlPath = path.join(configDir, 'config.yaml');
  const jsonPath = path.join(configDir, 'config.json');

  // 1. config.yaml が存在すれば最優先
  if (fs.existsSync(yamlPath)) {
    console.log('✅ config.yaml を読み込み中...');
    const yamlContent = fs.readFileSync(yamlPath, 'utf8');
    return yaml.load(yamlContent);
  }

  // 2. config.json が存在する場合
  if (fs.existsSync(jsonPath)) {
    console.log('📄 config.json を読み込み中...');
    const jsonContent = fs.readFileSync(jsonPath, 'utf8');
    const config = JSON.parse(jsonContent);

    // 旧形式か新形式かを判定
    const isLegacyFormat =
      'geminiApiKey' in config ||
      'geminiPostMode' in config ||
      'autoNotePrompt' in config ||
      'aichatRandomTalkEnabled' in config;

    if (isLegacyFormat) {
      console.log('🔄 旧形式の設定を新形式に変換中...');
      const migratedConfig = migrateLegacyConfig(config);

      // config.yaml として保存
      const yamlContent = yaml.dump(migratedConfig, {
        indent: 2,
        lineWidth: 120,
        quotingType: '"',
      });

      // コメント付きYAMLを生成
      const commentedYaml = addConfigComments(yamlContent);

      fs.writeFileSync(yamlPath, commentedYaml, 'utf8');
      console.log('✨ config.yaml を生成しました！');
      console.log('💡 今後は config.yaml を編集してください');

      return migratedConfig;
    } else {
      // 新形式のJSONならそのまま使用
      return config;
    }
  }

  throw new Error(
    '❌ 設定ファイル (config.yaml または config.json) が見つかりません'
  );
}

/**
 * YAMLにコメントを追加
 */
function addConfigComments(yamlContent: string): string {
  const header = `# 藍 (Ai) Configuration File
#
# このファイルは藍の動作を制御する設定ファイルです。
# YAML形式で記述され、コメントも書けるため設定の管理が容易です。
#
# 詳細な設定については example.config.yaml を参照してください。

`;

  return header + yamlContent;
}
