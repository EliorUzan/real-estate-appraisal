// The deployed appraisal UI and the existing local development UI use the same
// authenticated wake endpoint. An explicit operator setting replaces defaults.
export function onboardingOrigins(configured:string|undefined):string[]{
 return (configured??'http://127.0.0.1:5175,https://real-estate-appraisal-sage.vercel.app')
  .split(',').map(value=>value.trim()).filter(Boolean);
}
