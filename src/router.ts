import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        {
            path: '/',
            redirect: '/ai-cut'
        },
        {
            path: '/ai-cut',
            name: 'AutoSync',
            component: () => import('./views/AutoSyncView.vue'),
            meta: { title: 'AutoSync', icon: '✂️' }
        },
        {
            path: '/editor',
            name: 'Editor',
            component: () => import('./views/EditorView.vue'),
            meta: { title: 'Video Editor', icon: '🎬' }
        },
        {
            path: '/reup',
            name: 'Reup',
            component: () => import('./views/ReupView.vue'),
            meta: { title: 'Reup Video', icon: '🔄' }
        },
        {
            path: '/v2img',
            name: 'V2Image',
            component: () => import('./views/V2ImageView.vue'),
            meta: { title: 'Video to Image', icon: '🖼️' }
        },
        {
            path: '/metadata',
            name: 'Metadata',
            component: () => import('./views/MetadataView.vue'),
            meta: { title: 'Metadata', icon: '🛡️' }
        },
        {
            path: '/settings',
            name: 'Settings',
            component: () => import('./views/SettingsView.vue'),
            meta: { title: 'Settings', icon: '⚙️' }
        }
    ]
})

export default router
