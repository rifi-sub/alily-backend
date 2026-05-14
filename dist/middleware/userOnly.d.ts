import { Request, Response, NextFunction } from 'express';
export interface UserRequest extends Request {
    user?: any;
}
export default function userOnly(req: UserRequest, res: Response, next: NextFunction): Promise<void | Response<any, Record<string, any>>>;
