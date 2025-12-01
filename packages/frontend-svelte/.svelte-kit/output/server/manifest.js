export const manifest = (() => {
function __memo(fn) {
	let value;
	return () => value ??= (value = fn());
}

return {
	appDir: "_app",
	appPath: "_app",
	assets: new Set(["favicon.ico"]),
	mimeTypes: {},
	_: {
		client: {start:"_app/immutable/entry/start.CmgfLzFZ.js",app:"_app/immutable/entry/app.Ct7K4CN5.js",imports:["_app/immutable/entry/start.CmgfLzFZ.js","_app/immutable/chunks/c3dera9h.js","_app/immutable/chunks/D2EQC8l4.js","_app/immutable/chunks/DJM65MCA.js","_app/immutable/entry/app.Ct7K4CN5.js","_app/immutable/chunks/Bs8XZAKh.js","_app/immutable/chunks/D2EQC8l4.js","_app/immutable/chunks/D7aSGHJx.js","_app/immutable/chunks/DJM65MCA.js","_app/immutable/chunks/D0Sx8eNH.js","_app/immutable/chunks/B4DoV3Yi.js"],stylesheets:[],fonts:[],uses_env_dynamic_public:false},
		nodes: [
			__memo(() => import('./nodes/0.js')),
			__memo(() => import('./nodes/1.js')),
			__memo(() => import('./nodes/2.js'))
		],
		remotes: {
			
		},
		routes: [
			{
				id: "/",
				pattern: /^\/$/,
				params: [],
				page: { layouts: [0,], errors: [1,], leaf: 2 },
				endpoint: null
			},
			{
				id: "/api/ai/chat",
				pattern: /^\/api\/ai\/chat\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/ai/chat/_server.ts.js'))
			},
			{
				id: "/api/ai/vision",
				pattern: /^\/api\/ai\/vision\/?$/,
				params: [],
				page: null,
				endpoint: __memo(() => import('./entries/endpoints/api/ai/vision/_server.ts.js'))
			}
		],
		prerendered_routes: new Set([]),
		matchers: async () => {
			
			return {  };
		},
		server_assets: {}
	}
}
})();
