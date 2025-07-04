import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import * as TOML from '@iarna/toml';
type Config = {
  host: string;
  i: string;
  [key: string]: any; // その他の設定項目
};

function loadConfigTemplate(): Config {
  const templatePath = resolve('./example.config.toml');

  if (!existsSync(templatePath)) {
    throw new Error(
      'example.config.toml が見つかりません。テンプレートファイルが必要です。'
    );
  }

  try {
    const templateData = readFileSync(templatePath, 'utf8');
    return TOML.parse(templateData) as Config;
  } catch (error) {
    throw new Error(`example.config.toml の読み込みに失敗しました: ${error}`);
  }
}

/**
 * オブジェクトの深い比較で不足しているキーを検出
 */
function findMissingKeys(
  userObj: any,
  templateObj: any,
  prefix = ''
): string[] {
  const missingKeys: string[] = [];

  for (const key in templateObj) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (!(key in userObj)) {
      missingKeys.push(fullKey);
    } else if (
      typeof templateObj[key] === 'object' &&
      templateObj[key] !== null &&
      !Array.isArray(templateObj[key]) &&
      typeof userObj[key] === 'object' &&
      userObj[key] !== null
    ) {
      // ネストしたオブジェクトを再帰的にチェック
      missingKeys.push(
        ...findMissingKeys(userObj[key], templateObj[key], fullKey)
      );
    }
  }

  return missingKeys;
}

/**
 * ネストしたキーの値を取得
 */
function getNestedValue(obj: any, keyPath: string): any {
  const keys = keyPath.split('.');
  let current = obj;

  for (const key of keys) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = current[key];
  }

  return current;
}

/**
 * 値のプレビュー表示用フォーマット
 */
function formatValuePreview(value: any): string {
  if (typeof value === 'string') {
    if (value.length > 50) {
      return `"${value.substring(0, 47)}..."`;
    }
    return `"${value}"`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.length === 1) return `["${value[0]}"]`;
    return `["${value[0]}", ...] (${value.length}個)`;
  }
  if (typeof value === 'object' && value !== null) {
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return `{ ${keys.slice(0, 2).join(', ')}${keys.length > 2 ? ', ...' : ''} }`;
  }
  return String(value);
}

/**
 * 設定ファイルの差分チェックと通知
 */
export function checkMissingConfigKeys(userConfig: Config): Config {
  console.log('🔍 設定ファイルチェックを開始します');

  try {
    // テンプレートを読み込み
    const template = loadConfigTemplate();

    // 不足しているキーを検出
    const missingKeys = findMissingKeys(userConfig, template);

    if (missingKeys.length === 0) {
      console.log('✅ 設定ファイルは完全です');
      return userConfig;
    }

    if (missingKeys.length > 0) {
      console.log(
        `\n📋 以下の設定項目が不足しています (${missingKeys.length}個):`
      );
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      missingKeys.forEach((key) => {
        const defaultValue = getNestedValue(template, key);
        const valuePreview = formatValuePreview(defaultValue);
        console.log(`   📝 ${key} = ${valuePreview}`);
      });

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('💡 これらの設定を config.toml に追加することをお勧めします');
      console.log('📖 詳細は example.config.toml を参照してください');
    }

    return userConfig;
  } catch (error) {
    console.error('❌ 設定差分チェック中にエラーが発生しました:', error);
    console.log('⚠️  設定チェックをスキップして起動を続行します');
    return userConfig;
  }
}

/**
 * 起動時の設定チェック（メイン関数）
 */
export function performStartupConfigCheck(): Config {
  console.log('🚀 藍 (Ai) 起動中...');
  console.log('📋 設定ファイルチェックを開始します');

  const configPath = resolve('./config.toml');

  if (!existsSync(configPath)) {
    console.error('❌ config.toml が見つかりません');
    console.log(
      '💡 example.config.toml をコピーして config.toml を作成してください'
    );
    process.exit(1);
  }

  try {
    // 現在の設定を読み込み
    const configData = readFileSync(configPath, 'utf8');
    const userConfig = TOML.parse(configData) as Config;

    // 設定差分チェックと通知
    const checkedConfig = checkMissingConfigKeys(userConfig);

    console.log('✅ 設定ファイルチェック完了');
    console.log('🎉 Bot起動準備完了！');

    return checkedConfig;
  } catch (error) {
    console.error('❌ 設定ファイルの読み込みに失敗しました:', error);
    process.exit(1);
  }
}
