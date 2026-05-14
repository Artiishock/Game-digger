import{r as g}from"./vendor-react-BUFxUdQd.js";import{g as $}from"./vendor-pixi-DF0tMQ74.js";var h={exports:{}},w={},j={exports:{}},_={};/**
 * @license React
 * use-sync-external-store-shim.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var d=g;function x(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var D=typeof Object.is=="function"?Object.is:x,I=d.useState,V=d.useEffect,O=d.useLayoutEffect,R=d.useDebugValue;function z(t,e){var u=e(),c=I({inst:{value:u,getSnapshot:e}}),r=c[0].inst,n=c[1];return O(function(){r.value=u,r.getSnapshot=e,E(r)&&n({inst:r})},[t,u,e]),V(function(){return E(r)&&n({inst:r}),t(function(){E(r)&&n({inst:r})})},[t]),R(u),u}function E(t){var e=t.getSnapshot;t=t.value;try{var u=e();return!D(t,u)}catch{return!0}}function C(t,e){return e()}var M=typeof window>"u"||typeof window.document>"u"||typeof window.document.createElement>"u"?C:z;_.useSyncExternalStore=d.useSyncExternalStore!==void 0?d.useSyncExternalStore:M;j.exports=_;var G=j.exports;/**
 * @license React
 * use-sync-external-store-shim/with-selector.production.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var b=g,L=G;function T(t,e){return t===e&&(t!==0||1/t===1/e)||t!==t&&e!==e}var k=typeof Object.is=="function"?Object.is:T,A=L.useSyncExternalStore,F=b.useRef,P=b.useEffect,U=b.useMemo,W=b.useDebugValue;w.useSyncExternalStoreWithSelector=function(t,e,u,c,r){var n=F(null);if(n.current===null){var f={hasValue:!1,value:null};n.current=f}else f=n.current;n=U(function(){function m(s){if(!S){if(S=!0,o=s,s=c(s),r!==void 0&&f.hasValue){var i=f.value;if(r(i,s))return l=i}return l=s}if(i=l,k(o,s))return i;var p=c(s);return r!==void 0&&r(i,p)?(o=s,i):(o=s,l=p)}var S=!1,o,l,a=u===void 0?null:u;return[function(){return m(e())},a===null?void 0:function(){return m(a())}]},[e,u,c,r]);var v=A(t,n[0],n[1]);return P(function(){f.hasValue=!0,f.value=v},[v]),W(v),v};h.exports=w;var B=h.exports;const N=$(B),H={},y=t=>{let e;const u=new Set,c=(o,l)=>{const a=typeof o=="function"?o(e):o;if(!Object.is(a,e)){const s=e;e=l??(typeof a!="object"||a===null)?a:Object.assign({},e,a),u.forEach(i=>i(e,s))}},r=()=>e,m={setState:c,getState:r,getInitialState:()=>S,subscribe:o=>(u.add(o),()=>u.delete(o)),destroy:()=>{(H?"production":void 0)!=="production"&&console.warn("[DEPRECATED] The `destroy` method will be unsupported in a future version. Instead use unsubscribe function returned by subscribe. Everything will be garbage-collected if store is garbage-collected."),u.clear()}},S=e=t(c,r,m);return m},Q=t=>t?y(t):y;export{Q as c,N as u};
