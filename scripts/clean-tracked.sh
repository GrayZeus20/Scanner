cd /c/laragon/www/Scanner
git rm -r --cached node_modules test-results initial-state.png test-dummy.png localhost.json localhost.md test.js > /tmp/gitrm.log 2>&1
echo "exit=$?"
tail -2 /tmp/gitrm.log
