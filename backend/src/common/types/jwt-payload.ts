export interface JwtPayload {
  /** User ID (maps to User.id / UUID) */
  sub: string;
  email: string;
}
