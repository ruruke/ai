import { bindThis } from '@/decorators.js';
import Module from '@/module.js';
import Message from '@/message.js';
import config from '@/config.js';
import { User, UserDetailed } from '@/misskey/user.js';
import { UserFormatter } from '@/utils/user-formatter.js';

export default class extends Module {
  public readonly name = 'follow';

  @bindThis
  public install() {
    this.unfollowNonFollowers();
    setInterval(this.unfollowNonFollowers, 1000 * 60 * 60 * 3); // 3時間に1回

    return {
      mentionHook: this.mentionHook,
    };
  }

  @bindThis
  private async mentionHook(msg: Message) {
    const allowedHosts = config.followAllowedHosts || [];
    const followExcludeInstances = config.followExcludeInstances || [];

    if (
      msg.text &&
      (msg.text.includes('フォロー') ||
        msg.text.includes('フォロバ') ||
        msg.text.includes('follow me'))
    ) {
      // ユーザーの詳細情報を取得
      let detailedUser: UserDetailed;
      try {
        detailedUser = (await this.ai.api('users/show', {
          userId: msg.userId,
        })) as UserDetailed;
      } catch (error) {
        console.error('Failed to fetch user details:', error);
        return false;
      }

      // console.log('User host:', detailedUser.host);
      // console.log('User following status:', detailedUser.isFollowing);

      if (
        !detailedUser.isFollowing &&
        (detailedUser.host == null ||
          detailedUser.host === '' ||
          this.shouldFollowUser(
            detailedUser.host,
            allowedHosts,
            followExcludeInstances
          ))
      ) {
        try {
          await this.ai.api('following/create', {
            userId: msg.userId,
          });
          return {
            reaction: msg.friend.love >= 0 ? 'like' : null,
          };
        } catch (error) {
          console.error('Failed to follow user:', error);
          return false;
        }
      } else if (!detailedUser.isFollowing) {
        await msg.reply('どなたさまですか？');
        return {
          reaction: msg.friend.love >= 0 ? 'hmm' : null,
        };
      }
    } else {
      return false;
    }
    return false;
  }

  /**
   * リモートユーザーをフォローすべきかどうかを判定する
   * @param host ユーザーのホスト
   * @param allowedHosts 許可されたホストのリスト
   * @param excludedHosts 除外されたホストのリスト
   * @returns フォローすべき場合はtrue、そうでない場合はfalse
   */
  private shouldFollowUser(
    host: string,
    allowedHosts: string[],
    excludedHosts: string[]
  ): boolean {
    // followAllowedHostsが存在する場合、followExcludeInstancesを無視する
    if (allowedHosts.length > 0) {
      return this.isHostAllowed(host, allowedHosts);
    }
    // followAllowedHostsが存在しない場合、followExcludeInstancesを適用する
    return !this.isHostExcluded(host, excludedHosts);
  }

  /**
   * ホストが許可されたホストリストに含まれるかどうかを判定する
   * @param host ユーザーのホスト
   * @param allowedHosts 許可されたホストのリスト
   * @returns 許可された場合はtrue、そうでない場合はfalse
   */
  private isHostAllowed(host: string, allowedHosts: string[]): boolean {
    for (const allowedHost of allowedHosts) {
      if (allowedHost.startsWith('*')) {
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

  /**
   * ホストが除外されたホストリストに含まれるかどうかを判定する
   * @param host ユーザーのホスト
   * @param excludedHosts 除外されたホストのリスト
   * @returns 除外された場合はtrue、そうでない場合はfalse
   */
  private isHostExcluded(host: string, excludedHosts: string[]): boolean {
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

  @bindThis
  private async unfollowNonFollowers() {
    this.log('Unfollowing non-followers...');

    try {
      const following = await this.fetchAllUsers('users/following');
      this.log(
        `Fetched ${following.length} following users: ${following.map((u) => UserFormatter.formatUserForLog(u)).join(', ')}`
      );

      const followers = await this.fetchAllUsers('users/followers');
      this.log(
        `Fetched ${followers.length} followers: ${followers.map((u) => UserFormatter.formatUserForLog(u)).join(', ')}`
      );

      const followerIds = followers.map((u) => u.id);
      this.log(`Follower IDs: ${followerIds.join(', ')}`);

      const usersToUnfollow = following.filter((u) => {
        const isFollowedByBot = followerIds.includes(u.id);
        if (!isFollowedByBot) {
          this.log(
            `User ${UserFormatter.formatUserForLog(u)} is followed by bot but not following back.`
          );
        }
        return !isFollowedByBot;
      });
      this.log(
        `Found ${usersToUnfollow.length} users to unfollow: ${usersToUnfollow.map((u) => UserFormatter.formatUserForLog(u)).join(', ')}`
      );

      if (usersToUnfollow.length === 0) {
        this.log('No users to unfollow.');
        return;
      }

      this.log(`Unfollowing ${usersToUnfollow.length} users...`);

      for (const user of usersToUnfollow) {
        try {
          await this.ai.api('following/delete', { userId: user.id });
          this.log(`Unfollowed ${UserFormatter.formatUserForLog(user)}`);
        } catch (error) {
          console.error(`Failed to unfollow @${user.username}:`, error);
        }
      }

      this.log('Unfollowing process finished.');
    } catch (error) {
      console.error('Failed to unfollow non-followers:', error);
    }
  }

  private async fetchAllUsers(
    endpoint: 'users/following' | 'users/followers'
  ): Promise<User[]> {
    let allUsers: User[] = [];
    let untilId: string | undefined = undefined;

    while (true) {
      const responseItems = await this.ai.api<
        | { id: string; followee: User; follower?: never }[]
        | { id: string; follower: User; followee?: never }
      >(endpoint, {
        userId: this.ai.account.id,
        limit: 100,
        untilId: untilId,
      });

      if (!responseItems || responseItems.length === 0) {
        break;
      }

      let extractedUsers: User[];
      if (endpoint === 'users/following') {
        extractedUsers = responseItems
          .map((item) => (item as { followee: User }).followee)
          .filter((user) => user && user.id);
      } else {
        // users/followers
        extractedUsers = responseItems
          .map((item) => (item as { follower: User }).follower)
          .filter((user) => user && user.id);
      }
      allUsers = allUsers.concat(extractedUsers);

      if (responseItems.length < 100) {
        // Optimization: if less than limit, no more pages
        break;
      }
      untilId = responseItems[responseItems.length - 1].id;
    }

    return allUsers;
  }
}
