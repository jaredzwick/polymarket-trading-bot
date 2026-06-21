Output demo.gif

Require bun

Set Shell "bash"
Set FontSize 14
Set Width 1200
Set Height 600
Set Theme "Dracula"
Set Padding 20

# Title frame
Type "# polymarket-trading-bot — 30-second magic moment"
Sleep 500ms
Ctrl+C

# Step 1: Clone
Type "git clone https://github.com/jaredzwick/polymarket-trading-bot"
Enter
Sleep 2s

# Step 2: Install
Type "cd polymarket-trading-bot && bun install"
Enter
Sleep 3s

# Step 3: Show config
Type "cat .env.example | head -20"
Enter
Sleep 1s

# Step 4: Start in dry-run mode
Type "DRY_RUN=true STRATEGIES=market-maker TOKEN_IDS=demo bun run src/main.ts"
Enter
Sleep 2s

# Show bot starting
Sleep 500ms
Type ""
Sleep 2s

# Show a signal firing (simulated)
Sleep 1500ms
Type ""
Sleep 1500ms

# End
Ctrl+C
Sleep 500ms
