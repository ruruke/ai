import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import Message from '@/message.js';

export default class extends Module {
  public readonly name = 'reaction-config';

  @bindThis
  public install() {
    return {
      mentionHook: this.mentionHook,
    };
  }

  @bindThis
  private async mentionHook(msg: Message) {
    if (!msg.includes(['reaction'])) return false;

    const text = msg.extractedText.toLowerCase();

    // 状態確認
    if (text.includes('status')) {
      const enabled = this.isReactionEnabled(msg);
      msg.reply(`リアクション機能: ${enabled ? '有効' : '無効'}`);
      return true;
    }

    // 設定変更 - 単語単位での判定
    const words = text.split(/\s+/);

    if (
      words.includes('true') ||
      words.includes('on') ||
      words.includes('enable') ||
      words.includes('オン')
    ) {
      this.setReactionEnabled(msg, true);
      msg.reply('リアクション機能を有効にしました');
      return true;
    }

    if (
      words.includes('false') ||
      words.includes('off') ||
      words.includes('disable') ||
      words.includes('オフ')
    ) {
      this.setReactionEnabled(msg, false);
      msg.reply('リアクション機能を無効にしました');
      return true;
    }

    return false;
  }

  @bindThis
  public isReactionEnabled(msg: Message): boolean {
    const userData = msg.friend.getPerModulesData(this);
    return userData.autoReactionEnabled !== false; // デフォルト true
  }

  @bindThis
  private setReactionEnabled(msg: Message, enabled: boolean) {
    const userData = msg.friend.getPerModulesData(this);
    userData.autoReactionEnabled = enabled;
    msg.friend.setPerModulesData(this, userData);
  }
}
