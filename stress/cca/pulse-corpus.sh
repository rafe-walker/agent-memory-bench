#!/usr/bin/env bash
# Adversarial corpus for cc-anchor's pulse command matcher (scripts/pulse.jq) with the
# default pulse_match. W = must be detected as world-changing, Q = must stay quiet.
# A missed W means the pre-command pulse never runs: a stale deploy goes ahead.
# usage: CCA=<cc-anchor checkout> stress/cca/pulse-corpus.sh
set -uo pipefail
CCA=${CCA:?}
MATCH='deploy|migrate|publish|release|git push|terraform apply|kubectl apply'
miss=0; fa=0; nW=0; nQ=0
while IFS=$'\t' read -r want cmd note; do
  [[ -z "$want" || "$want" == \#* ]] && continue
  cmd=$(printf '%b' "$cmd")
  out=$(jq -nc --arg c "$cmd" '{tool_name:"Bash",tool_input:{command:$c}}' | jq -c --arg match "$MATCH" -f "$CCA/scripts/pulse.jq" 2>&1)
  if [[ "$out" == *'"world":[]'* ]]; then got=Q; elif [[ "$out" == *'"world":['* ]]; then got=W; else got="ERR:${out:0:80}"; fi
  [[ $want == W ]] && nW=$((nW+1)) || nQ=$((nQ+1))
  if [[ "$got" != "$want" ]]; then
    [[ $want == W ]] && miss=$((miss+1)) || fa=$((fa+1))
    printf 'FAIL want=%s got=%s  %-55s %s\n' "$want" "$got" "$(printf '%q' "$cmd" | cut -c1-55)" "$note"
  else printf 'ok   %s  %-55s %s\n' "$want" "$(printf '%q' "$cmd" | cut -c1-55)" "$note"; fi
done <<'CASES'
W	git push origin main	control
W	git -C ../svc push origin main	git global option before subcommand
W	git --no-pager push	git global option
W	git -c push.default=current push	git -c option
W	git  push	two spaces
W	git\tpush	tab
W	"git" push	quoted command name
W	kubectl -n prod apply -f k8s/	kubectl namespace flag before verb
W	kubectl --context prod apply -f k8s/	kubectl context flag
W	terraform -chdir=infra apply -auto-approve	terraform -chdir
W	TF_VAR_env=prod terraform apply	env prefix
W	sudo -E terraform apply	sudo flags
W	env -i PATH=/usr/bin ./deploy.sh	env flags
W	bash -c "kubectl apply -f x.yaml"	bash -c
W	sh -c 'git push'	sh -c
W	eval "$DEPLOY_CMD deploy"	eval
W	python3 -c "import os; os.system('git push')"	python -c
W	node -e "require('child_process').execSync('npm publish')"	node -e
W	make release	make target
W	npm run deploy	npm script named deploy
W	./scripts/deploy.sh --env prod	script path
W	(cd svc && git push)	subshell
W	{ git push; }	brace group
W	cat <<EOF | bash\ngit push\nEOF	here-doc piped to bash
W	ssh prod 'sudo systemctl restart api && ./deploy'	ssh
W	nohup ./deploy.sh &	nohup background
W	time git push	time
W	command git push	command builtin
W	exec git push	exec
W	xargs -I{} git push {} < remotes.txt	xargs
W	git push --force-with-lease	control
W	timeout 600 terraform apply	timeout wrapper
W	nice -n 10 ./deploy.sh	nice with flags
W	watch -n 60 ./deploy.sh	watch wrapper
W	git commit -am wip && git push	chain
W	gh release create v1.2.3	gh release
W	DRY_RUN=0 make -C infra deploy	make -C
Q	git commit -m "release notes"	quoted text
Q	grep -r deploy src/	read-only
Q	cat deploy.yaml	read-only
Q	echo git push	echo
Q	ls deployments/	no word boundary
Q	git log --grep=release	read-only git
Q	# git push\nls	comment
Q	npm run predeploy-check	predeploy
W	git -C "$dir" push	quoted -C arg
W	git -c "user.name=a b" push	quoted -c arg with space
W	git --git-dir=.git --work-tree=. push	long options with =
W	ls;git push	no space after ;
W	echo $(git push)	command substitution
W	echo `git push`	backticks
W	\\git push	backslash-escaped command
W	/usr/bin/git push	absolute path
W	g''it push	empty quotes inside word
W	"git" "push"	both quoted
W	$'git' push	ANSI-C quoted
W	git \\\npush	line continuation
W	terraform -chdir=infra \\\n  apply -auto-approve	multi-line terraform
W	kubectl -n prod \\\n  apply -f k8s/	multi-line kubectl
W	sudo -u deploy git push	sudo -u
W	nohup bash -c 'git push' &	nohup + bash -c
W	bash -lc "git push"	bash -lc
W	find . -maxdepth 0 -exec git push \\;	find -exec
W	parallel git push ::: origin backup	gnu parallel
W	git subtree push --prefix=dist origin gh-pages	git subtree push
W	kubectl --kubeconfig=x -n y apply -k .	two options before verb
W	if true; then git push; fi	if/then
W	for r in a b; do git push $r; done	for loop
W	while read r; do git push "$r"; done < remotes	while loop
W	case x in x) git push;; esac	case
W	f(){ git push; }; f	function def + call
W	git push 2>&1 | tee push.log	pipe to tee
W	>push.log git push	leading redirect
W	2>/dev/null git push	leading fd redirect
W	! git push	negation
W	time -p git push	time -p
W	command -p git push	command -p
W	perl -e 'system("git push")'	perl -e
W	ruby -e 'system("git push")'	ruby -e
W	python3 - <<'PY'\nimport subprocess; subprocess.run(["git","push"])\nPY	python here-doc
W	exec 3>&1; git push	exec redirect then push
W	coproc git push	coproc
Q	git commit -m "git push later"	quoted text 2
Q	echo "kubectl apply -f x"	echo quoted
Q	grep -n 'terraform apply' README.md	grep quoted
CASES
echo; echo "missed world-changing: $miss/$nW   false alarms: $fa/$nQ"
exit $(( miss > 0 ))
