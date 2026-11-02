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
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: this.username.trim(),
          password: this.password.trim()
        })
      });

      const data = await res.json();

      if (res.ok && data.success) {
        this.adminToken = data.token;
        localStorage.setItem('vibz_admin_token', data.token);
        localStorage.setItem('agyz_admin_token', data.token);
        this.authenticated = true;
        this.username = '';
        this.password = '';
        this.showToast(Vibz.i18n ? (Vibz.i18n.currentLang === 'ar' ? 'تم تسجيل الدخول بنجاح!' : 'Logged in successfully!') : 'Login successful', 'success');
        if (typeof this.loadSessions === 'function') await this.loadSessions();
        if (typeof this.loadSettings === 'function') await this.loadSettings();
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
      const res = await fetch('/api/auth/verify', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        this.authenticated = true;
        if (typeof this.loadSessions === 'function') await this.loadSessions();
        if (typeof this.loadSettings === 'function') await this.loadSettings();
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
