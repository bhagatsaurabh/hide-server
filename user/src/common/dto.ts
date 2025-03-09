import { User } from 'hide-common/model/user';

export type UserSearchDTO = {
  data: Partial<User>[];
  page: number;
};
