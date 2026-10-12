import test from 'node:test';
import assert from 'node:assert/strict';
import {onboardingOrigins} from '../supabase/functions/cli-onboarding/origins.ts';

test('both deployed and local app can reach onboarding; other origins cannot',()=>{
 const origins=onboardingOrigins(undefined);
 for(const origin of ['http://127.0.0.1:5175','https://real-estate-appraisal-sage.vercel.app'])assert.ok(origins.includes(origin));
 for(const origin of ['https://evil.example','null','https://real-estate-appraisal-sage.vercel.app.evil.example','https://preview.vercel.app'])assert.ok(!origins.includes(origin));
 assert.deepEqual(onboardingOrigins(' https://custom.example, '),['https://custom.example']);
 assert.deepEqual(onboardingOrigins(''),[]);
});
