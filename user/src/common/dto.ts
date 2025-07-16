import { User } from 'hide-common/model/user';

export type UserSearchHighlight = {
  field: keyof User;
  snippet: string;
};

export type UserSearchHits = {
  doc: Partial<User>;
  highlights: UserSearchHighlight[];
};

export type UserSearchDTO = {
  data: UserSearchHits[];
  page: number;
};

export type CreateUserDTO = {
  name: string;
  username: string;
};
