use base64::{engine::general_purpose, Engine as _};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize)]
pub struct JiraConfig {
    pub base_url: String,
    pub email: String,
    pub api_token: String,
}

#[derive(Debug, Serialize)]
pub struct JiraError {
    pub message: String,
    pub status: Option<u16>,
}

impl std::fmt::Display for JiraError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.message)
    }
}

fn make_auth_header(email: &str, token: &str) -> String {
    let credentials = format!("{}:{}", email, token);
    let encoded = general_purpose::STANDARD.encode(credentials.as_bytes());
    format!("Basic {}", encoded)
}

/// Busca um issue pelo key (ex: AUT-6722)
#[tauri::command]
pub async fn fetch_jira_issue(
    base_url: String,
    email: String,
    api_token: String,
    issue_key: String,
) -> Result<Value, String> {
    let client = Client::new();
    let url = format!(
        "{}/rest/api/3/issue/{}?expand=renderedFields,names,changelog",
        base_url.trim_end_matches('/'),
        issue_key.to_uppercase()
    );

    let auth = make_auth_header(&email, &api_token);

    let response = client
        .get(&url)
        .header("Authorization", auth)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Erro de conexão: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Jira API retornou {}: {}",
            status.as_u16(),
            error_body
        ));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear resposta: {}", e))?;

    Ok(json)
}

/// Busca múltiplos issues via JQL
#[tauri::command]
pub async fn fetch_jira_issues_bulk(
    base_url: String,
    email: String,
    api_token: String,
    issue_keys: Vec<String>,
) -> Result<Value, String> {
    if issue_keys.is_empty() {
        return Ok(serde_json::json!({ "issues": [] }));
    }

    let client = Client::new();
    let keys_str = issue_keys
        .iter()
        .map(|k| k.to_uppercase())
        .collect::<Vec<_>>()
        .join(",");

    let jql = format!("issueKey in ({})", keys_str);
    let url = format!(
        "{}/rest/api/3/search?jql={}&expand=changelog&maxResults=50",
        base_url.trim_end_matches('/'),
        urlencoding(&jql)
    );

    let auth = make_auth_header(&email, &api_token);

    let response = client
        .get(&url)
        .header("Authorization", auth)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Erro de conexão: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let error_body = response.text().await.unwrap_or_default();
        return Err(format!("Jira API retornou {}: {}", status.as_u16(), error_body));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear resposta: {}", e))?;

    Ok(json)
}

/// Valida as credenciais do Jira
#[tauri::command]
pub async fn validate_jira_credentials(
    base_url: String,
    email: String,
    api_token: String,
) -> Result<Value, String> {
    let client = Client::new();
    let url = format!("{}/rest/api/3/myself", base_url.trim_end_matches('/'));
    let auth = make_auth_header(&email, &api_token);

    let response = client
        .get(&url)
        .header("Authorization", auth)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Erro de conexão: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        return Err(format!(
            "Credenciais inválidas (HTTP {}). Verifique o base_url, email e API token.",
            status.as_u16()
        ));
    }

    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Erro ao parsear: {}", e))?;

    Ok(json)
}

/// Busca projetos acessíveis
#[tauri::command]
pub async fn fetch_jira_projects(
    base_url: String,
    email: String,
    api_token: String,
) -> Result<Value, String> {
    let client = Client::new();
    let url = format!(
        "{}/rest/api/3/project/search?maxResults=50&orderBy=name",
        base_url.trim_end_matches('/')
    );
    let auth = make_auth_header(&email, &api_token);

    let response = client
        .get(&url)
        .header("Authorization", auth)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("Erro de conexão: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Erro ao buscar projetos: HTTP {}", response.status()));
    }

    let json: Value = response.json().await.map_err(|e| e.to_string())?;
    Ok(json)
}

fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => c.to_string(),
            ' ' => "%20".to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}
