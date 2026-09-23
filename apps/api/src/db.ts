import {config} from 'dotenv';
import {resolve} from 'node:path';
import {PrismaClient} from '@prisma/client';
config({path:resolve(__dirname,'../../../.env')});
export const db = new PrismaClient();
