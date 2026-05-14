import { Request, Response, NextFunction } from 'express';
export interface AdminJwtPayload {
    admin?: boolean;
    iat?: number;
    exp?: number;
}
export default function adminOnly(req: Request, res: Response, next: NextFunction): void | Response<any, Record<string, any>>;
