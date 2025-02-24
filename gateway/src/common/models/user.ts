export interface IUser {
  uid: string;
  name: string;
  email: string;
  picture: string;
  issuer: string;
}

export class User implements IUser {
  constructor(
    public uid: string,
    public name: string,
    public email: string,
    public picture: string,
    public issuer: string,
  ) {}
}
