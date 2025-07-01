import got from 'got';
import config from '@/config.js';
import { bindThis } from '@/decorators.js';
import Friend from '@/friend.js';
import Message from '@/message.js';
import Module from '@/module.js';
import serifs from '@/serifs.js';

type ImagenRequest = {
  instances: Array<{
    prompt: string;
  }>;
  parameters: {
    sampleCount: number;
    aspectRatio?: string;
    personGeneration?: string;
  };
};

type ImagenResponse = {
  predictions?: Array<{
    bytesBase64Encoded?: string;
    mimeType?: string;
  }>;
  error?: {
    code: number;
    message: string;
  };
};

type ImagenApiResponse = ImagenResponse | null;

// デフォルト設定値
const DEFAULTS = {
  SAMPLE_COUNT: 1,
  ASPECT_RATIO: '1:1',
  PERSON_GENERATION: 'allow_adult',
} as const;

export default class extends Module {
  public readonly name = 'imagen';

  @bindThis
  public install() {
    // Imagen機能が有効かチェック
    if (!config.imagen?.enabled || !config.imagen?.apiKey) {
      this.log('Imagen機能が無効、またはAPIキーが設定されていません');
      return {};
    }

    return {
      mentionHook: this.mentionHook,
    };
  }

  @bindThis
  private async isFollowing(userId: string): Promise<boolean> {
    if (userId === this.ai.account.id) return true;
    try {
      const relation = await this.ai.api<Array<{ isFollowing?: boolean }>>(
        'users/relation',
        {
          userId,
        }
      );
      return relation?.[0]?.isFollowing === true;
    } catch (error) {
      this.log(`Failed to check following status: ${error}`);
      return false;
    }
  }

  @bindThis
  private async generateImage(prompt: string): Promise<ImagenApiResponse> {
    const model = config.imagen?.model || 'imagen-3.0-generate-002';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict`;

    const requestBody: ImagenRequest = {
      instances: [{ prompt }],
      parameters: {
        sampleCount: DEFAULTS.SAMPLE_COUNT,
        aspectRatio: DEFAULTS.ASPECT_RATIO,
        personGeneration: DEFAULTS.PERSON_GENERATION,
      },
    };

    try {
      this.log(`Imagen API request: ${prompt}`);

      const response = await got
        .post(apiUrl, {
          headers: {
            'x-goog-api-key': config.imagen!.apiKey!,
            'Content-Type': 'application/json',
          },
          json: requestBody,
          timeout: {
            request: 60000, // 60秒タイムアウト
          },
          retry: {
            limit: 2,
          },
        })
        .json<ImagenResponse>();

      return response;
    } catch (error: any) {
      this.log(`Imagen API error: ${error.message}`);
      return {
        error: {
          code: error.response?.statusCode || 500,
          message: error.message || 'Unknown error',
        },
      };
    }
  }

  @bindThis
  private async uploadToMisskey(
    imageBase64: string,
    mimeType: string
  ): Promise<string | null> {
    try {
      // Base64をBufferに変換
      const buffer = Buffer.from(imageBase64, 'base64');

      // ファイル拡張子を決定
      const extension = mimeType.includes('png') ? 'png' : 'jpg';
      const filename = `imagen_${Date.now()}.${extension}`;

      // Misskeyのドライブにアップロード
      const file = (await this.ai.upload(buffer, {
        filename,
        contentType: mimeType,
      })) as any;

      return file.id;
    } catch (error) {
      this.log(`Failed to upload image to Misskey: ${error}`);
      return null;
    }
  }

  @bindThis
  private async mentionHook(msg: Message) {
    if (!msg.includes(['imagen'])) {
      return false;
    }

    // Imagen機能が有効かチェック
    if (!config.imagen?.enabled || !config.imagen?.apiKey) {
      msg.reply(serifs.aichat.nothing('imagen'));
      return false;
    }

    // フォローチェック
    const isFollowing = await this.isFollowing(msg.userId);
    if (!isFollowing) {
      this.log(`User ${msg.userId} is not following, ignoring imagen request`);
      return false;
    }

    // プロンプトを抽出
    const text = msg.extractedText;
    const match = text.match(/imagen\s+(.+)/i);
    if (!match || !match[1]) {
      msg.reply(
        '画像生成のプロンプトを指定してください。\n例: @藍 imagen a cute cat'
      );
      return false;
    }

    const prompt = match[1].trim();
    if (prompt.length === 0) {
      msg.reply('画像生成のプロンプトを指定してください。');
      return false;
    }

    // 生成開始
    this.log(`Starting image generation for: ${prompt}`);

    // 生成中リアクションを追加
    this.ai.api('notes/reactions/create', {
      noteId: msg.id,
      reaction: '🎨',
    });

    try {
      // 画像生成
      const response = await this.generateImage(prompt);

      if (!response || response.error) {
        const errorMsg = response?.error?.message || '不明なエラー';
        this.log(`Image generation failed: ${errorMsg}`);
        msg.reply(`画像生成でエラーが発生しました: ${errorMsg}`);
        return { reaction: '❌️' };
      }

      if (!response.predictions || response.predictions.length === 0) {
        this.log('No image generated');
        msg.reply('画像が生成されませんでした。プロンプトを見直してください。');
        return { reaction: '❌️' };
      }

      const prediction = response.predictions[0];
      if (!prediction.bytesBase64Encoded) {
        this.log('No image data in response');
        msg.reply('画像データが取得できませんでした。');
        return { reaction: '❌️' };
      }

      // 画像をドライブにアップロード
      const mimeType = prediction.mimeType || 'image/png';
      const fileId = await this.uploadToMisskey(
        prediction.bytesBase64Encoded,
        mimeType
      );

      if (!fileId) {
        msg.reply('画像のアップロードに失敗しました。');
        return { reaction: '❌️' };
      }

      // 画像付きでリプライ
      const replyText = `「${prompt}」で画像を生成しました！`;
      const file = { id: fileId };
      msg.reply(replyText, {
        file: file,
      });

      this.log(`Image generation completed for: ${prompt}`);
      return { reaction: 'like' };
    } catch (error) {
      this.log(`Unexpected error during image generation: ${error}`);
      msg.reply('画像生成中に予期しないエラーが発生しました。');
      return { reaction: '❌️' };
    }
  }
}
