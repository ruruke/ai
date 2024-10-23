import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import Message from '@/message.js';

export default class extends Module {
    public readonly name = 'follow';

    @bindThis
    public install() {
        return {
            mentionHook: this.mentionHook
        };
    }

    @bindThis
    private async mentionHook(msg: Message) {
        console.log('User host:', msg.user.host);
        console.log('User following status:', msg.user.isFollowing);  // 修正：クォーテーションを正しく閉じる
        const allowedHosts = ['mi.0il.pw', 'key.0il.pw', 'mstdn.0il.pw', 'sharkey.0il.pw', 'yoiyami.0il.pw'];

        // 修正：msg.textでインクルードを確認
        if (msg.text && (msg.text.includes('フォロー') || msg.text.includes('フォロバ') || msg.text.includes('follow me'))) {
            if (!msg.user.isFollowing && (msg.user.host == null || allowedHosts.includes(msg.user.host))) {
                try {
                    await this.ai.api('following/create', {  // 修正：awaitを追加
                        userId: msg.userId,
                    });
                    return {
                        reaction: msg.friend.love >= 0 ? 'like' : null
                    };
                } catch (error) {
                    console.error('Failed to follow user:', error);
                }
            } else {
                return {
                    reaction: msg.friend.love >= 0 ? 'hmm' : null
                };
            }
        } else {
            return false;
        }
    }
}
