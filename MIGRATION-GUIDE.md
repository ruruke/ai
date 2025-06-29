# 🚀 設定ファイル移行ガイド

藍のGemini設定が統一化され、YAML形式もサポートされました！

## 🆕 新機能

### ✨ YAML設定ファイル対応
- `config.yaml` でより読みやすい設定管理
- コメント記述可能で設定の説明が書ける
- 階層構造でGemini設定を整理

### 🔄 自動移行機能
- 旧形式の `config.json` から自動変換
- 新形式の `config.yaml` を自動生成

## 📋 設定ファイル優先順位

```
1. config.yaml     (最優先 - 新形式YAML)
2. config.json     (非推奨)
```

## 🏗️ 設定構造の変化

### 📛 旧形式 (非推奨)
```json
{
  "geminiApiKey": "your-api-key",
  "geminiModel": "gemini-2.5-flash",
  "geminiPostMode": "both",
  "prompt": "チャットプロンプト",
  "autoNotePrompt": "自動ノートプロンプト",
  "autoNoteIntervalMinutes": 60,
  "autoNoteDisableNightPosting": true,
  "geminiAutoNoteProbability": 0.1,
  "aichatRandomTalkEnabled": true,
  "aichatRandomTalkProbability": 0.2,
  "aichatRandomTalkIntervalMinutes": 60,
  "aichatGroundingWithGoogleSearchAlwaysEnabled": true
}
```

### ✅ 新形式 (推奨)
```yaml
gemini:
  enabled: true
  apiKey: "your-api-key"
  model: "gemini-2.5-flash"
  thinkingBudget: -1  # -1: 動的thinking, 0: 無効, 128-32768: 固定トークン数

  # 自動ノート投稿機能
  autoNote:
    enabled: true
    prompt: "自動ノートプロンプト"
    probability: 0.1
    intervalMinutes: 60
    disableNightPosting: true
    nightHours:
      start: 23
      end: 5

  # ランダムトーク機能
  randomTalk:
    enabled: true
    probability: 0.2
    intervalMinutes: 60
    followingOnly: true

  # チャット機能
  chat:
    enabled: true
    prompt: "チャットプロンプト"
    groundingWithGoogleSearch: true
```

## 🐳 Docker環境での移行

### 📋 段階的移行（推奨）

**現在のconfig.jsonマウント + config.yamlマウント追加**

#### Step 1: 空のYAMLファイルを作成
```bash
touch config.yaml  # 空のconfig.yamlファイルを作成
```

#### Step 2: docker-compose.ymlを更新
```yaml
version: '3'
services:
  app:
    image: ghcr.io/lqvp/ai:latest
    platform: linux/amd64
    environment:
      - TZ=Asia/Tokyo
    volumes:
      - './config.json:/ai/config.json:ro'  # 既存（読み込み専用）
      - './config.yaml:/ai/config.yaml'     # 新規（読み書き可能）
      - './font.ttf:/ai/font.ttf:ro'
      - './data:/ai/data'
    restart: always
```

#### Step 3: コンテナを再起動
```bash
docker-compose down
docker-compose up -d
```

#### 🎯 移行プロセス
1. **初回起動**: `config.json`から設定を読み取り
2. **自動変換**: 新形式に変換して`config.yaml`に書き込み
3. **次回以降**: `config.yaml`を優先使用

### 🔄 完全移行後（任意）

**config.yamlのみの運用に切り替え**

```yaml
version: '3'
services:
  app:
    volumes:
      - './config.yaml:/ai/config.yaml'     # YAMLのみ
      - './font.ttf:/ai/font.ttf:ro'
      - './data:/ai/data'
```

### 🛠️ その他の移行オプション

#### Option A: 手動でYAMLファイルを作成
```bash
# example.config.yamlをベースに作成
cp example.config.yaml config.yaml
vim config.yaml  # 設定値を編集
```

#### Option B: コンテナ内で確認
```bash
# コンテナに入って設定を確認
docker exec -it container-name bash
cat config.yaml  # 生成されたYAMLを確認
```

## 🔧 手動移行手順

### Step 1: example.config.yamlをコピー
```bash
cp example.config.yaml config.yaml
```

### Step 2: 設定値を編集
```bash
vim config.yaml  # または好きなエディタで編集
```

### Step 3: 旧設定ファイルをバックアップ
```bash
mv config.json config.json.backup
```

## ⚠️ 破壊的変更

以下の設定項目は削除されました：
- `geminiApiKey` → `gemini.apiKey`
- `geminiModel` → `gemini.model`
- `geminiPostMode` → 削除 (機能別enableフラグに変更)
- `prompt` → `gemini.chat.prompt`
- `autoNotePrompt` → `gemini.autoNote.prompt`
- `autoNoteIntervalMinutes` → `gemini.autoNote.intervalMinutes`
- `autoNoteDisableNightPosting` → `gemini.autoNote.disableNightPosting`
- `geminiAutoNoteProbability` → `gemini.autoNote.probability`
- `aichatRandomTalkEnabled` → `gemini.randomTalk.enabled`
- `aichatRandomTalkProbability` → `gemini.randomTalk.probability`
- `aichatRandomTalkIntervalMinutes` → `gemini.randomTalk.intervalMinutes`
- `aichatGroundingWithGoogleSearchAlwaysEnabled` → `gemini.chat.groundingWithGoogleSearch`

## 🆘 トラブルシューティング

### 設定ファイルが読み込まれない場合
1. ファイルの存在確認: `ls -la config.*`
2. 権限確認: `chmod 644 config.yaml`
3. YAML文法確認: エディタのYAML検証機能を使用

## 📚 追加リソース

- [example.config.yaml](./example.config.yaml) - 完全な設定例
- [YAML文法ガイド](https://yaml.org/spec/1.2/spec.html)

---

ご不明な点がございましたら、Issueにお気軽にお寄せください！
