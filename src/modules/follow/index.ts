import { bindThis } from "@/decorators.js";
import Module from "@/module.js";
import Message from "@/message.js";
import config from "@/config.js";

export default class extends Module {
	public readonly name = "follow";

	@bindThis
	public install() {
		return {
			mentionHook: this.mentionHook,
		};
	}

	@bindThis
	private async mentionHook(msg: Message) {
		console.log("User host:", msg.user.host);
		console.log("User following status:", msg.user.isFollowing);
		const allowedHosts = config.followAllowedHosts || [];
		const followExcludeInstances = config.followExcludeInstances || [];
		const followExcludeUserIds = config.followExcludeUserIds || [];

		if (
			msg.text &&
			(msg.text.includes("フォロー") ||
				msg.text.includes("フォロバ") ||
				msg.text.includes("follow me"))
		) {
			if (
				!msg.user.isFollowing &&
				(msg.user.host == null ||
					this.isUserIDExcluded(msg.user.id, followExcludeUserIds) || this.isHostAllowed(msg.user.host, allowedHosts) || !this.isHostExcluded(msg.user.host, followExcludeInstances)) 
			) {
				try {
					await this.ai.api("following/create", {
						userId: msg.userId,
					});
					return {
						reaction: msg.friend.love >= 0 ? "like" : null,
					};
				} catch (error) {
					console.error("Failed to follow user:", error);
				}
			} else if (!msg.user.isFollowing) {
				await msg.reply("どなたさまですか？");
				return {
					reaction: msg.friend.love >= 0 ? "hmm" : null,
				};
			}
		} else {
			return false;
		}
	}

	private isHostAllowed(host: string, allowedHosts: string[]): boolean {
		for (const allowedHost of allowedHosts) {
			if (allowedHost.startsWith("*")) {
				const domain = allowedHost.slice(1);
				if (host.endsWith(domain)) {
					return true;
				}
			} else if (host === allowedHost) {
				return true;
			}
		}
		return false;
	}

	private isHostExcluded(host: string,excludedHosts: string[]): boolean {
		for (const excludedHost of excludedHosts) {
				if (excludedHost.startsWith('*')) {
						const domain = excludedHost.slice(1);
						if (host.endsWith(domain)) {
								return true;
						}
				} else if (host === excludedHost) {
						return true;
				}
		}
		return false;
	}

	private isUserIDExcluded(host: string,excludedUserIds: string[]): boolean {
		for (const excludedUserId of excludedUserIds) {
				if (excludedUserId.startsWith('*')) {
						const userid = excludedUserId.slice(1);
						if (host.endsWith(userid)) {
								return true;
						}
				} else if (host === excludedUserId) {
						return true;
				}
		}
		return false;
	}
}
