import {createContext,useContext} from "react";
import type {CliProviderStatus} from "./cli-status";
import type {LoginChallenge,LoginSession,OnboardingStatus} from "./cli-onboarding";
export type ConnectionsState={providers:CliProviderStatus[];loading:boolean;verified:boolean;error:string;refresh:()=>void};
export type ConnectionController={connections:ConnectionsState;status:OnboardingStatus|null;session:LoginSession|null;challenge:LoginChallenge|null;visible:boolean;busy:boolean;error:string;open:()=>void;close:()=>void;start:()=>Promise<void>;cancel:()=>Promise<void>;wake:()=>Promise<void>;refresh:()=>void;setSession:(value:LoginSession)=>void;firstUse:()=>void};
export const CliConnectionContext=createContext<ConnectionController|null>(null);
export const useCliConnectionController=()=>useContext(CliConnectionContext);
