package ru.e40in.microdocs;

import android.app.Activity;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.security.KeyChain;
import android.view.View;
import android.webkit.ClientCertRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.TextView;

import java.security.PrivateKey;
import java.security.cert.X509Certificate;

/**
 * microdocs для Android — окно с веб-версией. Интерфейс приходит с сервера,
 * без сети его отдаёт service worker из кеша, данные лежат в IndexedDB WebView.
 *
 * Клиентский сертификат берётся из системного хранилища: при первом запросе
 * Android показывает выбор сертификата, выбранный запоминается и дальше
 * подставляется без вопросов.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "microdocs";
    private static final String CERT_ALIAS = "certAlias";

    private WebView web;
    private View errorView;
    private TextView errorTitle;
    private TextView errorText;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        setContentView(R.layout.activity_main);

        web = findViewById(R.id.web);
        errorView = findViewById(R.id.error);
        errorTitle = findViewById(R.id.error_title);
        errorText = findViewById(R.id.error_text);
        findViewById(R.id.retry).setOnClickListener(v -> retry());

        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        // localStorage: в нём очередь неотправленных правок.
        settings.setDomStorageEnabled(true);
        web.setWebViewClient(new Client());

        // Пересоздание окна (например, смена светлой темы на тёмную) — та же страница.
        if (state == null || web.restoreState(state) == null) web.loadUrl(BuildConfig.APP_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    /** «Назад» листает историю страниц, как в браузере; на первой — выход. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    private void showError(int title, int text) {
        errorTitle.setText(title);
        errorText.setText(text);
        errorView.setVisibility(View.VISIBLE);
    }

    private void retry() {
        errorView.setVisibility(View.GONE);
        // Отказ от выбора сертификата WebView помнит до перезапуска — забываем его.
        WebView.clearClientCertPreferences(() -> web.reload());
    }

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private class Client extends WebViewClient {
        @Override
        public void onReceivedClientCertRequest(WebView view, ClientCertRequest request) {
            // Сертификат — только своему серверу, чужой сайт его не получит.
            if (!request.getHost().equals(Uri.parse(BuildConfig.APP_URL).getHost())) {
                request.ignore();
                return;
            }
            String saved = prefs().getString(CERT_ALIAS, null);
            if (saved != null) {
                provide(request, saved);
                return;
            }
            // Системный выбор; в списке только сертификаты центра, который назвал сервер.
            KeyChain.choosePrivateKeyAlias(MainActivity.this, alias -> {
                if (alias == null) {
                    request.cancel();
                    return;
                }
                prefs().edit().putString(CERT_ALIAS, alias).apply();
                provide(request, alias);
            }, new String[] {"RSA", "EC"}, request.getPrincipals(), request.getHost(), request.getPort(), null);
        }

        /** Ключ из KeyChain читается не в главном потоке. */
        private void provide(ClientCertRequest request, String alias) {
            new Thread(() -> {
                try {
                    PrivateKey key = KeyChain.getPrivateKey(MainActivity.this, alias);
                    X509Certificate[] chain = KeyChain.getCertificateChain(MainActivity.this, alias);
                    if (key != null && chain != null) {
                        request.proceed(key, chain);
                        return;
                    }
                } catch (Exception ignored) {
                    // Сертификат удалили или отозвали доступ — ниже спросим заново.
                }
                prefs().edit().remove(CERT_ALIAS).apply();
                request.cancel();
            }).start();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            // Если интерфейс уже в кеше service worker, без сети сюда не попадаем.
            if (error.getErrorCode() == ERROR_FAILED_SSL_HANDSHAKE) {
                showError(R.string.error_cert_title, R.string.error_cert_text);
            } else {
                showError(R.string.error_offline_title, R.string.error_offline_text);
            }
        }
    }
}
