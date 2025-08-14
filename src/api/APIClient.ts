import * as fs from 'fs';
import got from 'got';
import { FormData, File } from 'formdata-node';
import { bindThis } from '@/decorators.js';
import config from '@/config.js';
import log from '@/utils/log.js';
import chalk from 'chalk';

/**
 * Misskey API クライアント
 * API通信の責任を担当
 */
export default class APIClient {
  @bindThis
  private log(msg: string) {
    log(`[${chalk.cyan('APIClient')}]: ${msg}`);
  }

  /**
   * デフォルトのUser-Agentを取得
   */
  private getDefaultUserAgent(): string {
    return (
      config.userAgent?.http || 'Misskey-Ai-Bot(https://github.com/lqvp/ai)'
    );
  }

  /**
   * ファイルをドライブにアップロードします
   */
  @bindThis
  public async upload(
    file: Buffer | fs.ReadStream,
    meta: { filename: string; contentType: string }
  ) {
    try {
      const form = new FormData();
      form.set('i', config.i);
      form.set(
        'file',
        new File([file], meta.filename, { type: meta.contentType })
      );

      const res = await got
        .post({
          url: `${config.apiUrl}/drive/files/create`,
          body: form,
          headers: {
            'User-Agent': this.getDefaultUserAgent(),
          },
        })
        .json();
      return res;
    } catch (error) {
      console.error(`File upload failed: ${error}`);
      throw error;
    }
  }

  /**
   * 投稿します
   */
  @bindThis
  public async post(param: any): Promise<any> {
    // リプライの場合は元の投稿の公開範囲を継承するため、visibilityを上書きしない
    if (
      !param.replyId &&
      config.postNotPublic &&
      (!param.visibility || param.visibility == 'public')
    )
      param.visibility = 'home';
    if (!param.visibility && config.defaultVisibility)
      param.visibility = config.defaultVisibility;
    const res = await this.api<{ createdNote: any }>('notes/create', param);
    return res.createdNote;
  }

  /**
   * 指定ユーザーにチャットメッセージを送信します
   */
  @bindThis
  public sendMessage(userId: any, param: any) {
    return this.api('chat/messages/create-to-user', {
      toUserId: userId,
      ...param,
    });
  }

  /**
   * APIを呼び出します
   */
  @bindThis
  public api<T>(endpoint: string, param?: any): Promise<T> {
    this.log(`API: ${endpoint}`);
    return got
      .post(`${config.apiUrl}/${endpoint}`, {
        json: { i: config.i, ...param },
        headers: {
          'User-Agent': this.getDefaultUserAgent(),
        },
      })
      .json<T>();
  }
}
