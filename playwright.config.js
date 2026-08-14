import { defineConfig, devices } from '@playwright/test';

const PORT=8179;
export default defineConfig({
  testDir:'./e2e',fullyParallel:true,workers:6,forbidOnly:Boolean(process.env.CI),retries:0,reporter:'list',timeout:60000,
  use:{baseURL:`http://127.0.0.1:${PORT}`,trace:'retain-on-failure'},
  projects:[{name:'chromium',use:{...devices['Desktop Chrome'],launchOptions:{args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}}}],
  webServer:{command:`python3 -m http.server ${PORT} --bind 127.0.0.1`,url:`http://127.0.0.1:${PORT}/index.html`,reuseExistingServer:false,stdout:'ignore',stderr:'ignore'}
});
