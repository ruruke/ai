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
    private async mentionHook(msg: Message): Promise<boolean> {
        try {
            // マスターユーザーチェック
            if (!msg.user?.username || msg.user.username !== config.master) {
                return false;
            }

            // メッセージテキストの存在チェック
            if (!msg.text) {
                return false;
            }

            // コマンドパターンの検証
            const setLoveMatch = msg.text.match(/^setLove (-?\d+) @([\w-]+(?:@[\w\.-]+)?)/);
            if (!setLoveMatch) {
                return false;
            }

            const [, loveAmountStr, targetIdentifier] = setLoveMatch;
            const loveAmount = parseInt(loveAmountStr, 10);

            // ユーザー名の処理
            const username = targetIdentifier.split('@')[0];

            try {
                // ユーザー情報の取得
                const targetUser = await this.ai.api('users/show', {
                    username: username,
                });

                if (!targetUser) {
                    await msg.reply(`ユーザー @${username} が見つかりません。`, { immediate: true });
                    return true;
                }

                // Friendインスタンスの作成と親愛度の設定
                const friend = new Friend(this.ai, { user: targetUser });
                await friend.forceSetLove(loveAmount);

                // 成功メッセージの送信
                await msg.reply(`@${targetIdentifier} の親愛度を ${loveAmount} に設定しました。`, {
                    immediate: true
                });
                return true;

            } catch (apiError) {
                console.error('API Error:', apiError);
                await msg.reply('ユーザー情報の取得中にエラーが発生しました。', { immediate: true });
                return true;
            }

        } catch (error) {
            console.error('mentionHook Error:', error);
            await msg.reply('コマンドの処理中にエラーが発生しました。', { immediate: true });
            return true;
        }
    }
}
