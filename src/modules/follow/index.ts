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

	const allowedHosts = ['mi.0il.pw', 'key.0il.pw', 'mstdn.0il.pw', 'sharkey.0il.pw', 'yoiyami.0il.pw'];

	@bindThis
	private async mentionHook(msg: Message) {
		if (msg.text && msg.includes(['フォロー', 'フォロバ', 'follow me'])) {
			if (!msg.user.isFollowing && (msg.user.host == null || !allowedHosts.includes(msg.user.host))) {
				this.ai.api('following/create', {
					userId: msg.userId,
				});
				return {
					reaction: msg.friend.love >= 0 ? 'like' : null
				};
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
