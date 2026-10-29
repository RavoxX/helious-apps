#ifndef HELIOUS_NATIVE_H
#define HELIOUS_NATIVE_H
// JSON request/response bridge. Free every non-null response once with helious_free.
char *helious_call(const char *request);
void helious_free(char *response);
#endif
