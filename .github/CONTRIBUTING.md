Please follow the guidelines below when contributing to this repository.

## Code Contribution
1. Fork this repository to your own account.
2. Clone your fork locally and create a new branch using the naming convention: *feature-name*.
3. Add your documentation as Markdown files.
4. Before pushing your changes, run 
```bash
npm run start
```
in the terminal and open the provided link to verify that the Markdown is rendering correctly.

5. Before pushing your changes, also run:
```bash
npm run build
```
to verify that the documentation website builds successfully. A pre-push hook is configured to automatically run this command before every push. If the build fails, the push will be blocked.

6. Commit your changes with clear messages.
7. Push the changes to your fork.
8. Open a Pull Request to the main branch.