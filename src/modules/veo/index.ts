import got from 'got';
import config from '@/config.js';
import { bindThis } from '@/decorators.js';
import Friend from '@/friend.js';
import Message from '@/message.js';
import Module from '@/module.js';
import serifs from '@/serifs.js';
import { sleep } from '@/utils/sleep.js';

// Veo API用の型定義
type VeoRequest = {
  instances: Array<{
    prompt: string;
  }>;
};

type VeoStartResponse = {
  name: string;
  error?: {
    code: number;
    message: string;
  };
};

type VeoStatusResponse = {
  name: string;
  done: boolean;
  response?: {
    generateVideoResponse: {
      generatedSamples: Array<{
        video: {
          uri: string;
        };
      }>;
    };
  };
  error?: {
    code: number;
    message: string;
  };
};

export default class extends Module {
  public readonly name = 'veo';

  private get apiKey(): string | undefined {
    return config.veo?.apiKey || config.gemini?.apiKey;
  }

  @bindThis
  public install() {
    if (!config.veo?.enabled || !this.apiKey) {
      this.log('Veo機能が無効、またはAPIキーが設定されていません');
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
  private async generateVideo(
    prompt: string
  ): Promise<string | { error: string }> {
    if (!this.apiKey) {
      return { error: 'APIキーが設定されていません' };
    }

    const model = config.veo?.model || 'veo-3.0-fast-generate-preview';
    const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
    const startUrl = `${baseUrl}/models/${model}:predictLongRunning`;

    const requestBody: VeoRequest = {
      instances: [{ prompt }],
    };

    try {
      this.log(`Veo API request: ${prompt}`);

      // Start video generation
      const startResponse = await got
        .post(startUrl, {
          headers: {
            'x-goog-api-key': this.apiKey,
            'Content-Type': 'application/json',
          },
          json: requestBody,
          timeout: { request: 60000 },
        })
        .json<VeoStartResponse>();

      if (startResponse.error) {
        return { error: startResponse.error.message };
      }

      const operationName = startResponse.name;
      this.log(`Video generation started, operation name: ${operationName}`);

      // Poll for video generation status
      const pollInterval = config.veo?.pollIntervalMs ?? 10000;
      const deadline = Date.now() + (config.veo?.maxWaitMs ?? 15 * 60 * 1000);
      while (Date.now() < deadline) {
        await sleep(pollInterval);

        const statusResponse = await got
          .get(`${baseUrl}/${operationName}`, {
            headers: {
              'x-goog-api-key': this.apiKey,
            },
          })
          .json<VeoStatusResponse>();

        if (statusResponse.done) {
          if (statusResponse.error) {
            return { error: statusResponse.error.message };
          }

          const videoUri =
            statusResponse.response?.generateVideoResponse
              ?.generatedSamples?.[0]?.video?.uri;
          if (videoUri) {
            this.log(`Video is ready, URI: ${videoUri}`);
            return videoUri;
          } else {
            return { error: '動画URIが取得できませんでした' };
          }
        }
        this.log('Video generation in progress...');
      }
      return {
        error:
          '動画生成がタイムアウトしました（しばらくしてから再試行してください）',
      };
    } catch (error: any) {
      this.log(`Veo API error: ${error}`);
      const message = error instanceof Error ? error.message : String(error);
      return { error: message };
    }
  }

  @bindThis
  private async downloadVideo(videoUri: string): Promise<Buffer | null> {
    try {
      const videoBuffer = await got(videoUri, {
        headers: {
          'x-goog-api-key': this.apiKey,
        },
        responseType: 'buffer',
      }).buffer();
      return videoBuffer;
    } catch (error) {
      this.log(`Failed to download video: ${error}`);
      return null;
    }
  }

  @bindThis
  private async uploadToMisskey(videoBuffer: Buffer): Promise<string | null> {
    try {
      const filename = `veo_${Date.now()}.mp4`;
      const file = (await this.ai.upload(videoBuffer, {
        filename,
        contentType: 'video/mp4',
      })) as { id: string };
      return file.id;
    } catch (error) {
      this.log(`Failed to upload video to Misskey: ${error}`);
      return null;
    }
  }

  @bindThis
  private async mentionHook(msg: Message) {
    if (!msg.includes(['veo'])) {
      return false;
    }

    if (!config.veo?.enabled || !this.apiKey) {
      msg.reply(serifs.aichat.nothing('veo'));
      return false;
    }

    const isFollowing = await this.isFollowing(msg.userId);
    if (!isFollowing) {
      this.log(`User ${msg.userId} is not following, ignoring veo request`);
      return false;
    }

    const text = msg.extractedText;
    const match = text.match(/veo\s+(.+)/i);
    if (!match || !match[1]) {
      msg.reply(
        '動画生成のプロンプトを指定してください。\n例: @藍 veo a beautiful landscape'
      );
      return false;
    }

    const prompt = match[1].trim();
    if (prompt.length === 0) {
      msg.reply('動画生成のプロンプトを指定してください。');
      return false;
    }

    this.log(`Starting video generation for: ${prompt}`);

    this.ai.api('notes/reactions/create', {
      noteId: msg.id,
      reaction: '🎬',
    });

    try {
      const result = await this.generateVideo(prompt);

      if (typeof result !== 'string') {
        this.log(`Video generation failed: ${result.error}`);
        msg.reply(`動画生成でエラーが発生しました: ${result.error}`);
        return { reaction: '❌️' };
      }

      const videoBuffer = await this.downloadVideo(result);
      if (!videoBuffer) {
        msg.reply('動画のダウンロードに失敗しました。');
        return { reaction: '❌️' };
      }

      const fileId = await this.uploadToMisskey(videoBuffer);
      if (!fileId) {
        msg.reply('動画のアップロードに失敗しました。');
        return { reaction: '❌️' };
      }

      const replyText = `「${prompt}」で動画を生成しました！`;
      msg.reply(replyText, {
        file: { id: fileId },
      });

      this.log(`Video generation completed for: ${prompt}`);
      return { reaction: '✅' };
    } catch (error) {
      this.log(`Unexpected error during video generation: ${error}`);
      msg.reply('動画生成中に予期しないエラーが発生しました。');
      return { reaction: '❌️' };
    }
  }
}
