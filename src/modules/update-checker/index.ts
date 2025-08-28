import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import { InstallerResult } from '@/ai.js';
import config from '@/config.js';
import { createRequire } from 'module';
import got from 'got';

const require = createRequire(import.meta.url);
const pkg = require('../../../package.json');

type GitHubRelease = {
	tag_name: string;
	html_url: string;
};

export default class UpdateCheckerModule extends Module {
	public readonly name = 'update-checker';

	@bindThis
	public install(): InstallerResult {
		if (!config.updateChecker?.enabled) {
			return {};
		}

		this.log('Update checker is enabled.');

		// 1分後に初回チェック、以降は設定された間隔で定期的にチェック
		this.setTimeoutWithPersistence(60 * 1000, { immediate: true });

		return {};
	}

	@bindThis
	public async timeoutCallback(data?: any) {
		if (data?.immediate) {
			this.check();
		}

		// 次回のチェックをスケジュール
		const interval = (config.updateChecker?.intervalMinutes ?? 60) * 60 * 1000;
		this.setTimeoutWithPersistence(interval);
	}

	@bindThis
	private async check() {
		this.log('Checking for updates...');

		const repo = config.updateChecker?.repository;
		if (!repo) {
			this.log('Repository is not configured.');
			return;
		}

		try {
			const release = await got(`https://api.github.com/repos/${repo}/releases/latest`).json<GitHubRelease>();
			const latestVersion = release.tag_name.replace(/^v/, '');
			const currentVersion = pkg._v;

			this.log(`Latest version: ${latestVersion}, Current version: ${currentVersion}`);

			if (this.isNewer(latestVersion, currentVersion)) {
				this.log(`New version found: ${latestVersion}`);
				const master = config.master;
				if (master) {
					this.ai.post({
						text: `@${master} 新しいバージョン **${latestVersion}** がリリースされました！🎉\n[リリースノート](${release.html_url})\n\n現在のバージョンは ${currentVersion} です。`,
						visibility: 'home',
					});
				}
			}
		} catch (error) {
			this.log('Failed to fetch release info.');
			console.error(error);
		}
	}

	/**
		* Compare two version strings.
		* Handles simple semver-like strings (e.g., '3.2.3-lqvp').
		* @param v1 New version
		* @param v2 Current version
		* @returns True if v1 is newer than v2
		*/
	@bindThis
	private isNewer(v1: string, v2: string): boolean {
		// This is a simple string comparison, which works for the current versioning scheme.
		// For more complex semver, a dedicated library would be better.
		return v1 > v2;
	}
}
