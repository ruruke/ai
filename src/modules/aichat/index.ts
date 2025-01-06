import { bindThis } from "@/decorators.js";
import Module from "@/module.js";
import serifs from "@/serifs.js";
import Message from "@/message.js";
import config from "@/config.js";
import urlToBase64 from "@/utils/url2base64.js";
import got from "got";
import { Note } from "@/misskey/note.js";

type AiChat = {
	question: string;
	prompt: string;
	api: string;
	key: string;
};

type Base64Image = {
	type: string;
	base64: string;
};

const GEMINI_API_ENDPOINT =
	"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent";

export default class extends Module {
	public readonly name = "aichat";

	@bindThis
	public install() {
		setInterval(this.replySocialTimelineNotes, 1000 * 60 * 60);
		return {
			mentionHook: this.mentionHook,
		};
	}

	@bindThis
	private async genTextByGemini(aiChat: AiChat, image: Base64Image | null) {
		this.log("Generate Text By Gemini...");
		let parts: (
			| { text: string; inline_data?: undefined }
			| { inline_data: { mime_type: string; data: string }; text?: undefined }
		)[];

		if (image === null) {
			parts = [{ text: aiChat.prompt + aiChat.question }];
		} else {
			parts = [
				{ text: aiChat.prompt + aiChat.question },
				{
					inline_data: {
						mime_type: image.type,
						data: image.base64,
					},
				},
			];
		}

		const options = {
			url: aiChat.api,
			searchParams: {
				key: aiChat.key,
			},
			json: {
				contents: { parts: parts },
			},
		};

		this.log(JSON.stringify(options));

		try {
			const res_data = await got
				.post(options, { parseJson: (res) => JSON.parse(res) })
				.json();
			this.log(JSON.stringify(res_data));

			if (res_data?.candidates?.[0]?.content?.parts?.[0]?.text) {
				return res_data.candidates[0].content.parts[0].text;
			}
		} catch (err: unknown) {
			this.log("Error By Call Gemini");
			if (err instanceof Error) {
				this.log(`${err.name}\n${err.message}\n${err.stack}`);
			}
		}

		return null;
	}

	@bindThis
	private async note2base64Image(notesId: string) {
		const noteData: any = await this.ai!.api("notes/show", { noteId: notesId });
		let fileType: string | undefined, thumbnailUrl: string | undefined;

		if (noteData?.files?.[0]) {
			fileType = noteData.files[0].type;
			thumbnailUrl = noteData.files[0].thumbnailUrl;

			if (fileType && thumbnailUrl) {
				try {
					const image = await urlToBase64(thumbnailUrl);
					return { type: fileType, base64: image } as Base64Image;
				} catch (err: unknown) {
					if (err instanceof Error) {
						this.log(`${err.name}\n${err.message}\n${err.stack}`);
					}
				}
			}
		}

		return null;
	}

	@bindThis
	private async replySocialTimelineNotes() {
		const tl = (await this.ai?.api("notes/hybrid-timeline", {
			limit: 10,
		})) as Note[];

		const interestedNotes = await Promise.all(
			tl.map(async (note) => {
				const noteDetails = (await this.ai?.api("notes/show", {
					noteId: note.id,
				})) as Note;
				const relation = (await this.ai?.api("users/relation", {
					userId: note.userId,
				})) as any;
				return {
					note,
					isInterested:
						note.userId !== this.ai?.account.id &&
						note.text != null &&
						note.cw == null &&
						noteDetails.reply !== null &&
						(note.visibility === "public" || note.visibility === "home") &&
						relation?.[0]?.isFollowing,
				};
			}),
		).then((results) =>
			results.filter((r) => r.isInterested).map((r) => r.note),
		);

		if (interestedNotes.length === 0) return false;

		const rnd = Math.floor(Math.random() * interestedNotes.length);
		const note = interestedNotes[rnd];

		if (!config.geminiApiKey) return false;

		let prompt = config.prompt || "";
		try {
			const userData = await this.ai?.api("users/show", {
				userId: note.userId,
			});
			const name = userData?.name || userData?.username || "名無し";
			prompt = prompt.replace("{name}", name);
		} catch (err: unknown) {
			this.log("Failed to get user data for name replacement.");
		}
		const base64Image = await this.note2base64Image(note.id);

		const aiChat = {
			question: note.text!,
			prompt: prompt,
			api: GEMINI_API_ENDPOINT,
			key: config.geminiApiKey,
		};

		const text = await this.genTextByGemini(aiChat, base64Image);

		if (text == null) {
			this.log(
				"The result is invalid. It seems that tokens and other items need to be reviewed.",
			);
			return false;
		}

		this.log("Replying...");
		this.ai?.post({
			text: serifs.aichat.post(text),
			replyId: note.id,
		});
	}

	@bindThis
	private async mentionHook(msg: Message) {
		if (
			msg.includes([this.name]) ||
			(((await this.ai?.api("notes/show", { noteId: msg.replyId })) as Note)
				?.userId === this.ai?.account.id &&
				(
					(await this.ai?.api("notes/show", { noteId: msg.replyId })) as Note
				).text?.includes(this.name))
		) {
			this.log("AiChat requested");
			const relation = (await this.ai?.api("users/relation", {
				userId: msg.userId,
			})) as any[];
			if (!relation?.[0]?.isFollowing) {
				this.log("The user is not following me:" + msg.userId);
				msg.reply("あなたはaichatを実行する権限がありません。");
				return false;
			}
		} else {
			return false;
		}

		let question = msg.extractedText
			.replace(new RegExp(this.name, "i"), "")
			.trim();

		let prompt = config.prompt || "";
		let replayPrompt = config.replayPrompt || "";

		// ユーザー名の置換を先に行う
		try {
			const userData = await this.ai?.api("users/show", { userId: msg.userId });
			const name = userData?.name || userData?.username || "名無し";
			prompt = prompt.replace("{name}", name);
		} catch (err: unknown) {
			this.log("Failed to get user data for name replacement.");
		}

		// 返信先の処理とプロンプトの連結
		if (msg.replyId) {
			const parentNote = (await this.ai?.api("notes/show", {
				noteId: msg.replyId,
			})) as Note;
			if (parentNote?.userId === this.ai?.account.id && parentNote.text) {
				// 親メッセージが自分の場合、replayPromptを使用
				question = replayPrompt + parentNote.text + "\n" + question;
			}
		}

		if (!config.geminiApiKey) {
			msg.reply(serifs.aichat.nothing);
			return false;
		}

		const base64Image = await this.note2base64Image(msg.id);

		const aiChat = {
			question: question,
			prompt: prompt,
			api: GEMINI_API_ENDPOINT,
			key: config.geminiApiKey,
		};

		const text = await this.genTextByGemini(aiChat, base64Image);

		if (text == null) {
			this.log(
					"The result is invalid. It seems that tokens and other items need to be reviewed.",
			);
			msg.reply(serifs.aichat.error);
			return false;
	}

	this.log("Replying...");
	if (msg.replyId) {
			// リプライにはタグを付けない
			msg.reply(text);
	} else {
			// 通常投稿にはタグを追加
			msg.reply(serifs.aichat.post(text));
	}

	return {
			reaction: "like",
	};
	}
}
