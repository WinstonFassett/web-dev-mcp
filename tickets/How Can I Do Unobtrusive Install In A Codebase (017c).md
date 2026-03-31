---
id: 017c
title: "How can I do unobtrusive install in a codebase"
status: open
deps: []
links: []
created: 2026-03-30T22:20:06Z
type: task
priority: 2
assignee: Winston Fassett
tags: [task]
---
# How Can I Do Unobtrusive Install In A Codebase


i want to install this into a work nextjs project at:


how can i do it unobtrusively ie without requiring everyone to run this in dev?

is there a way to have like the main config import something that could exist or not and be ignored from git? 

Yes, you can achieve this by creating a separate configuration file that is ignored by Git. Here's how you can do it:

1. Create a new configuration file, for example, `local.config.js`, in the root of your Next.js project.

2. Add the necessary configuration settings to this file. For example:

```javascript
module.exports = {
  // Your local configuration settings
    apiKey: 'your-api-key',
    otherSetting: 'some-value',
};
```

3. In your main configuration file (e.g., `next.config.js`), you can conditionally import the `local.config.js` file. If it exists, it will be imported; if not, it will be ignored. Here's how you can do that:

```javascript // next.config.js
const fs = require('fs');
let localConfig = {};
if (fs.existsSync('./local.config.js')) {
  localConfig = require('./local.config.js');
}
module.exports = {
  // Your main configuration settings
  ...localConfig, // Spread the local configuration settings if they exist
  // Other Next.js configurations
};
```

4. Finally, make sure to add `local.config.js` to your `.gitignore` file so that it is not tracked by Git:
```# .gitignore
local.config.js
```     

With this setup, each developer can create their own `local.config.js` file with their specific settings without affecting others, and it will not be included in version control.