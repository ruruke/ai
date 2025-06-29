import { bindThis } from '@/decorators.js';
import log from '@/utils/log.js';
import chalk from 'chalk';

type MentionHook = (msg: any, data?: any) => Promise<void | boolean | any>;
type ContextHook = (msg: any, data?: any) => Promise<void | boolean | any>;

/**
 * ストリーム管理クラス
 * リアルタイム通信とイベント処理を担当
 */
export default class StreamManager {
  public connection: any;
  private mentionHooks: MentionHook[];
  private contextHooks: { [moduleName: string]: ContextHook };
  private account: any;
  private api: (endpoint: string, param?: any) => Promise<any>;
  private onReceiveMessage: (message: any) => void;

  constructor(
    mentionHooks: MentionHook[],
    contextHooks: { [moduleName: string]: ContextHook },
    account: any,
    api: (endpoint: string, param?: any) => Promise<any>,
    onReceiveMessage: (message: any) => void
  ) {
    this.mentionHooks = mentionHooks;
    this.contextHooks = contextHooks;
    this.account = account;
    this.api = api;
    this.onReceiveMessage = onReceiveMessage;
  }

  @bindThis
  private log(msg: string) {
    log(`[${chalk.blue('StreamManager')}]: ${msg}`);
  }

  /**
   * ストリーム接続を初期化します（簡易版）
   */
  @bindThis
  public initializeStream() {
    this.log('StreamManager initialized (simplified)');
    // 複雑な実装は今後追加予定
  }

  /**
   * メンションフックを更新します
   */
  @bindThis
  public updateMentionHooks(mentionHooks: MentionHook[]) {
    this.mentionHooks = mentionHooks;
  }

  /**
   * コンテキストフックを更新します
   */
  @bindThis
  public updateContextHooks(contextHooks: { [moduleName: string]: ContextHook }) {
    this.contextHooks = contextHooks;
  }

  /**
   * ストリーム接続を閉じます
   */
  @bindThis
  public closeConnection() {
    if (this.connection) {
      this.connection.close();
      this.log('Stream connection closed');
    }
  }
}
