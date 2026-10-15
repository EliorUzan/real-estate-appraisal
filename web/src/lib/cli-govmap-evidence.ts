import type {PlotAnalysisData} from './plot-description';

export function freshGovMap(data:PlotAnalysisData|null,address:string,now=Date.now()){
 return !!data&&data.address===address&&Number.isFinite(Date.parse(data.retrievedAt))&&Math.abs(now-Date.parse(data.retrievedAt))<25*60000;
}

// Retain observations and warnings, excluding large raw transport diagnostics
// and geometry copies that add no facts to an environment description.
export function environmentGovMap(data:PlotAnalysisData){
 const layers=(items:NonNullable<PlotAnalysisData['spatial']>['layers'])=>items.map(layer=>({
  ...layer,features:layer.features.map(feature=>{
   if(feature&&typeof feature==='object'&&!Array.isArray(feature)){
    const {geometry:_geometry,geom:_geom,...attributes}=feature as Record<string,unknown>;
    void _geometry;void _geom;return attributes;
   }
   return feature;
  }),
 }));
 const s=data.spatial;
 return {kind:'govmap_environment',collectionMethod:'domain_browser_sdk',address:data.address,
  retrievedAt:data.retrievedAt,source:data.source,gush:data.gush,parcel:data.parcel,
  cadastralArea:data.cadastralArea,borders:data.borders,warnings:data.warnings,
  spatial:s?{crs:s.crs,addressPoint:s.addressPoint,geometryAnalysis:s.geometryAnalysis,
   layers:layers(s.layers),neighbors:s.neighbors.map(n=>({gush:n.gush,parcel:n.parcel,borders:n.borders,layers:layers(n.layers)})),
   topography:s.topography,warnings:s.warnings}:null};
}
