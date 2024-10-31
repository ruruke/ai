import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import Message from '@/message.js';
import Friend from '@/friend.js';
import config from '@/config.js';

export default class extends Module {
    public readonly name = 'admin';

    @bindThis
    public install() {
        return {
            mentionHook: this.mentionHook
        };
    }

    @bindThis
    private async mentionHook(msg: Message) {
        // 管理者のホストを確認
        if (msg.user.username !== config.master) return false;

        // コマンドが "setLove 10 @username" の形式かどうか確認
        const setLoveMatch = msg.text?.match(/^setLove (-?\d+) @([\w]+(?:@\w+\.\w+)?)$/);
        if (setLoveMatch) {
            const loveAmount = parseInt(setLoveMatch[1], 10);
            const targetIdentifier = setLoveMatch[2];

            // ローカルユーザーの場合は、ユーザーIDを直接取得
            const localUserId = targetIdentifier.startsWith('@') ? targetIdentifier.slice(1) : targetIdentifier;

            // ターゲットユーザーの情報を取得
            const targetUser = await this.ai.api('users/show', {
                username: localUserId,
            });

            // ユーザーがリモートであるかどうかを判定
            const isRemote = targetIdentifier.includes('@');
            const targetUserId = isRemote ? targetIdentifier.split('@')[0] : targetUser.id;

            // ターゲットユーザーが存在しない場合
            if (!targetUser) {
                await msg.reply(`ユーザー @${localUserId} が見つかりません。`, { immediate: true });
                return true;
            }

            // Friendインスタンスを作成
            const friend = new Friend(this.ai, { user: targetUser });
            friend.forceSetLove(loveAmount);

            // 確認メッセージを送信
            await msg.reply(`@${targetIdentifier} の親愛度を ${loveAmount} に設定しました。`, {
                immediate: true
            });
            return true;
        }

        return false;
    }
}
