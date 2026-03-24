using NUnit.Framework;
using Auth;

namespace AuthTests
{
    public class LoginTests
    {
        [Test]
        public void Login_HappyPath_StandardUser_Succeeds()
        {
            var login = new Login();
            Assert.IsTrue(login.LoginUser("standard_user"));
        }

        [Test]
        public void Login_Fails_For_OtherUser()
        {
            var login = new Login();
            Assert.IsFalse(login.LoginUser("other_user"));
        }
    }
}
