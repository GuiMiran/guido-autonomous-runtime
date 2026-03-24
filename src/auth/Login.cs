using System;

namespace Auth
{
    public class Login
    {
        public bool LoginUser(string username)
        {
            // Solo permite el usuario definido en login.data.json
            return username == "standard_user";
        }
    }
}
