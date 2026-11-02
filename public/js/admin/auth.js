// VibzCode Admin - Authentication Module
window.Vibz = window.Vibz || {};

Vibz.adminAuth = {
  authenticated: false,
  authLoading: false,
  authError: '',
  username: '',
  password: '',
  adminToken: '',

  async handleLogin() {
    if (!this.username || !this.password) {
      this.authError = Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'يرجى إدخال اسم المستخدم وكلمة المرور' : 'Please enter username and password') : 'Missing credentials';
      return;
    }

    this.authLoading = true;
    this.authError = '';

    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.username.trim(),
          password: this.password.trim()
        })
      });

      const data = await res.json();

      if (res.ok && data.success && data.token) {
        this.adminToken = data.token;
        localStorage.setItem('vibz_admin_token', data.token);
        localStorage.setItem('agyz_admin_token', data.token);
        this.authenticated = true;
        this.username = '';
        this.password = '';
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم تسجيل دخول المدير بنجاح!' : 'Logged in successfully!') : 'Login successful', 'success');
        if (typeof this.loadSessions === 'function') this.loadSessions();
        if (typeof this.loadSettings === 'function') this.loadSettings();
        if (typeof this.loadTelegramConfigs === 'function') this.loadTelegramConfigs();
      } else {
        this.authError = data.error || (Vibz.i18n && Vibz.i18n.currentLang === 'ar' ? 'اسم المستخدم أو كلمة المرور غير صحيحة' : 'Invalid username or password');
      }
    } catch (err) {
      this.authError = (Vibz.i18n && Vibz.i18n.currentLang === 'ar' ? 'فشل الاتصال بالخادم: ' : 'Connection error: ') + err.message;
    } finally {
      this.authLoading = false;
    }
  },

  async verifyAdminToken(token) {
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token
        },
        body: JSON.stringify({ token })
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.valid) {
          this.authenticated = true;
          if (typeof this.loadSessions === 'function') this.loadSessions();
          if (typeof this.loadSettings === 'function') this.loadSettings();
          if (typeof this.loadTelegramConfigs === 'function') this.loadTelegramConfigs();
        } else {
          this.handleLogout();
        }
      } else {
        this.handleLogout();
      }
    } catch (e) {
      this.handleLogout();
    }
  },

  handleLogout() {
    localStorage.removeItem('vibz_admin_token');
    localStorage.removeItem('agyz_admin_token');
    this.adminToken = '';
    this.authenticated = false;
    this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم تسجيل الخروج بنجاح' : 'Signed out successfully') : 'Logged out', 'info');
  }
};
