export type User = {
  id: string;
  name: string;
  username: string;
  host?: string | null;
  isFollowing?: boolean;
  isFollowed?: boolean;
  isBot: boolean;
};
